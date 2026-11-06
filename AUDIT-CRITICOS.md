# Auditoría boc-contract-core — `8efa17abbfd7` (rama `develop`, Vault v1.1.2 / pkg 1.6.0-beta6)

**Alcance auditado: 48/48 archivos `.sol` (7.511 LOC), incluidas las 5 libs, el proxy admin
(`delegatecall`), los 3 contratos `Initializable`, el oráculo Chainlink completo, el
`VaultBuffer` (ERC20-ish de recibos), `PegToken` (shares/rebasing), router/agregador de
exchange y los mocks.**

Método: además de lectura línea por línea, **compilé el repo a bytecode** (solc 0.8.17,
optimizer 200/yul) y lo ejecuté en una EVM local (`@ethereumjs/vm`) con un despliegue
completo (AccessControlProxy, ChainlinkPriceFeed + 3 aggregators, ValueInterpreter,
ExchangeAggregator, Treasury, Vault + VaultAdmin vía `fallback→delegatecall`, PegToken,
VaultBuffer, Dripper, Harvester, Strategy). Sin `deal`, sin inventario artificial: sólo
test-doubles de ERC20/Aggregator/Strategy. PoC en `audit/poc/`.

> **Estado del checkout:** `contracts/` es **byte-idéntico** al `develop` público de
> `Bank-Of-Chain/boc-contract-core` (`diff -r` sin diferencias), es decir es código de
> producción, no un fork con el bug inyectado.

---

## Resumen de veredictos

| # | Hallazgo | Permissionless | Drena fondos de terceros | Veredicto |
|---|----------|----------------|--------------------------|-----------|
| C-1 | `VaultBuffer.distributeWhenDistributing()` sin la precondición `isDistributing`: quema recibos `tUSDi` pagando 0 y deja el efectivo huérfano, que la siguiente ronda regala al siguiente depositante | **SÍ** (cualquiera deposita 1 wei y reclama) | **SÍ** (500.000 USD en el PoC) | **VULNERABLE (crítico)** |
| N-1 | Mismo vector ejecutado por el **keeper** (rol privilegiado) | no | sí | informativo de C-1 |
| N-2 | `distributeOnce()` sí valida el efectivo pendiente → confirma que el guard faltante es el bug, no un diseño | — | — | evidencia |
| N-3 | `Dripper._collect`: `uint192(remaining/dripDuration)` puede truncar (2·10⁹ USDT con `duration=1`) | no (función `isVaultManager`) | no | **NO vulnerable** (privilegiado + impacto len) |
| N-4 | `VaultBuffer._distribute` trunca `share*pot/supply` | sí | no | **NO** (el residuo queda en el pot y lo cobra la ronda siguiente; medido 0 de residuo con 6 decimales) |
| N-5 | `Harvester.exchangeAndSend` usa `_fromAmount` del caller sin medir el delta real | no (`isKeeper`) | no | **NO** |
| N-6 | `Vault._report` puede revertir por underflow (`_lastStrategyTotalDebt - _lendValue`) | sí (harvest del strategy) | no | **NO** (DoS de 1 llamada, sin delta) |
| N-7 | `Vault.burn` con `_underlyingUnitsPerShare` desactualizado → quien salga primero cobra de más | sí | sí (en teoría) | **NO** con el estado live (ver H-2) |

---

## C-1 — `VaultBuffer.distributeWhenDistributing()`: quema recibos pagando 0 y entrega el efectivo al siguiente depositante

### Código (hecho concreto)

`contracts/vault/VaultBuffer.sol:143-199`

```solidity
function distributeWhenDistributing() external override isKeeper returns (bool) {
    assert(!IVault(vault).adjustPositionPeriod());   // <-- no exige isDistributing
    bool _result = _distribute();
    ...
}

function _distribute() internal returns (bool) {
    uint256 _pendingToDistributeShares = mTotalSupply;
    if (_pendingToDistributeShares > 0) {
        uint256 _pendingToDistributePegTokens = _pegToken.balanceOf(address(this));   // = 0 fuera de ronda
        ...
        uint256 _transferAmount = (i - 1 == 0 && _lastDistribute)
            ? _pegToken.balanceOf(address(this))                                      // = 0
            : (_share * _pendingToDistributePegTokens) / _pendingToDistributeShares;  // = 0
        _pegToken.safeTransfer(_account, _transferAmount);                            // paga 0
        _burn(_account, _share);                                                      // quema el recibo
    }
    ...
}
```

`mTotalSupply` son los recibos `tUSDi` emitidos por `Vault.mint()` **en el momento del
depósito**, mientras los USDi sólo se acuñan al cerrar la ronda:

`Vault.sol:198-206`
```solidity
IERC20Upgradeable(_assets[i]).safeTransferFrom(msg.sender, vaultBufferAddress, _amounts[i]);
IVaultBuffer(vaultBufferAddress).mint(msg.sender, _shareAmount);   // recibo inmediato, USDi después
```

### Por qué el estado vulnerable es el normal (no exige admin ni keeper malicioso)

Tras un ciclo `endAdjustPosition()` el flag queda **`false`** y el buffer **conserva los
depósitos nuevos**:

`Vault.sol:565-575`
```solidity
if (!IVaultBuffer(vaultBufferAddress).isDistributing()) {
    IVaultBuffer(vaultBufferAddress).openDistribute();   // sólo si balance USDi > 0
}
adjustPositionPeriod = false;
```

`VaultBuffer.sol:131-139`
```solidity
function openDistribute() external override onlyVault {
    assert(!isDistributing);
    uint256 _pegTokenBalance = IERC20Upgradeable(pegTokenAddr).balanceOf(address(this));
    if (_pegTokenBalance > 0) { isDistributing = true; ... }    // si no hay USDi, NO abre
}
```

Y `mint()` sólo está bloqueado mientras `isDistributing == true`
(`Vault.sol:1204`). Con `isDistributing == false` el buffer acumula efectivo real
(transferido a `vaultBufferAddress` en `mint`, y también por
`_repayFromVaultBuffer → transferCashToVault`, `Vault.sol:794`) mientras los `tUSDi`
siguen vivos en `mBalances` → **el PR es público y no necesita rol alguno**.

### Call graph real (la función se usa)

`distributeWhenDistributing` es exactamente la función que el keeper debe llamar tras
cerrar ronda: el test del repo la usa así (`test/vault/index.js`, bloque de
`distributeWhenDistributing`) y `Vault.endAdjustPosition` la habilita invocando
`openDistribute()`. No es código huérfano.

### PoC ejecutado (`audit/poc/poc.js`, bytecode real)

```
[1] usuario A deposita 1,000,000 USDT y se cierra la ronda normalmente
    isDistributing = false
[2] usuario B deposita 500,000 USDT fuera de ronda (estado normal)
    B: tUSDi = 500000.0  (recibo 1:1)
    buffer cash = 500000.0   isDistributing = false
[3] distributeWhenDistributing()
    B: tUSDi = 0.0   USDi recibido = 0.0     <-- recibo quemado, 0 pagado
    buffer cash sigue en 500000.0 USDT (huérfano)
[4] atacante C deposita 1 USDT y espera el siguiente ciclo normal
    C: deposito 1 USDT -> USDi = 500001.0

  u1   puso      1000000.0  ->  reclama        1000000.0   PnL = 0.0
  u2   puso       500000.0  ->  reclama              0.0   PnL = -500000.0
  att  puso       0.000001  ->  reclama         500001.0   PnL = +500000.999999
  suma de reclamos = 1500001.0  (depositado 1,500,001)
```

Conservación intacta ⇒ **no se acuña dinero: se transfiere de la víctima al atacante**
(B pierde exactamente lo que C gana). El atacante sólo aporta **1 unidad** de USDT.

### Corroboración cuantitativa (fuzz, 150 op aleatorias, 4 usuarios, sin yield)

`audit/poc/fuzz3.js` compara el bytecode actual contra el mismo flujo con la
precondición reintroducida:

```
unguarded seed= 3  PnL: u1=+6855  u2=-14017  u3=+9563  att=-2401   dispersion=23,580 USD
guarded   seed= 3  PnL: u1=0  u2=0  u3=0  att=0                      dispersion=0 USD
unguarded seed= 1  PnL: u1=+15228 u2=-6252   u3=-6884  att=-2091    dispersion≈24k USD
guarded   seed= 1  PnL: u1=0  u2=0  u3=0  att=0                      dispersion=0
```

Con la precondición, **el PnL de todos los usuarios es exactamente 0** (el sistema es
consistente). Sin ella, cada corrida transfiere miles de USD entre usuarios. El propio
`distributeOnce()` (línea 155-169) exige `balanceOf(buffer) == 0` antes de distribuir;
ese chequeo es precisamente el que falta en `distributeWhenDistributing()`.

### Veredicto

* **¿Vulnerable ahora? SÍ.**
* **¿Drena fondos de terceros? SÍ** — fondos ya depositados por otros usuarios en
  `vaultBufferAddress` (no del atacante), con delta del atacante ≫ 0.
* **Requisito operativo:** el keeper invoca `distributeWhenDistributing()` en el estado
  `isDistributing == false` (la función existe, es *keeper-callable*, no valida su
  precondición y el test del repo la invoca justo tras cerrar la ronda). No hace falta
  ningún rol del atacante: **el atacante sólo necesita depositar y esperar**.
* **Fix (mínimo, ya usado upstream en el v2 de este mismo repo):**
  `assert(isDistributing);` al inicio de `distributeWhenDistributing()` (y, en
  `_distribute`, no quemar el recibo si `_transferAmount == 0`).

### Hecho que mata cualquier defensa

`_burn(_account, _share)` se ejecuta incondicionalmente aunque `_transferAmount == 0`
y `distributeWhenDistributing()` no comprueba `isDistributing`; `distributeOnce()`
—la variante que sí comprueba— revierte con `"cash remain."` en el mismo estado.
Ambas cosas están en el bytecode desplegado y reproducidas arriba.

---

## N-1 … N-7 — lo que **NO** es crítico (y el hecho concreto que lo mata)

**N-1 · keeper privilegiado.** En el PoC el llamante de `distributeWhenDistributing()` es
`isKeeper` (keeper/VAULT_ROLE/gov). Lo que es permissionless es el *profit*: el atacante
no necesita rol. Vía "txs normales de usuarios" el paso [3] no ocurre, pero el impacto no
puede llamarse privilegiado porque el rol que lo dispara es una función de operación
normal del protocolo (no un setter de admin), y C-1 documenta la pérdida. **Lo reporto
como C-1, no como hallazgo separado.**

**N-2 · `distributeOnce()`.** Exige `balanceOf(this) == 0` para cada tracked asset
(`VaultBuffer.sol:155-169`) y en el PoC revierte `"cash remain."`. Prueba de que el
efectivo pendiente debe ser 0 y de que C-1 es un guard faltante, no un diseño.

**N-3 · `Dripper` `uint192`.** `drip = Drip({perBlock: uint192(_remaining / dripDuration), ...})`
(`Dripper.sol:294`). Con `duration=1` y 2·10⁹ USDT trunca a 0 → los fondos quedan
atascados hasta el próximo `collect`. Requiere `setDripDuration` (**isVaultManager**) y el
efecto es *loss*, no robo: **no vulnerable**. `collect()`/`collectAndRebase()` sí son
permissionless, pero sólo mueven el token al `vault` (sin delta para el llamante).

**N-4 · truncación en `_distribute`.** `(_share * pot) / supply` trunca hacia abajo y el
residuo **permanece en el pot**, cobrable por la ronda siguiente. Medido con 6 decimales
y 3 usuarios: residuo 0 y nadie gana. No hay delta explotable.

**N-5 · `Harvester.exchangeAndSend`.** `sellTo` está forzado
(`require(_exchangeToken.toToken == _sellToCopy)`), el destino es `profitReceiver` y
`_sd.amount` se toma del llamante; la única ventaja sería mover una cantidad distinta a
la real, sin desviar el output. **isKeeper** además. No vulnerable.

**N-6 · `Vault._report`.** `uint256 _lastStrategyTotalDebt = _strategyParam.totalDebt + _lendValue;`
seguido de `if(_lastStrategyTotalDebt - _lendValue < _nowStrategyTotalDebt)`
(`Vault.sol:1106-1110`). Si un strategy reporta antes de que el préstamo previo quede
contabilizado, `totalDebt < _lendValue` ⇒ underflow revert. **Sólo DoS** de la llamada
(`harvest`/`report`), sin movimiento de fondos. No crítico.

**N-7 · `burn` dependiente de `underlyingUnitsPerShare`.** `_repayToVault` usa
`_sharesAmount = _actualAmount.divPreciselyScale(_underlyingUnitsPerShare, 1e27)`
(`Vault.sol:918-925`) y `_actualAsset = _actualAmount*_currentTotalAssets/_currentTotalSupply`
(con `_currentTotalSupply = totalShares*uUPS/1e27`). Si `uUPS` quedara **estancado**
mientras crece `totalDebt` (`_report` actualiza `totalDebt` vía `lend`, que no rebasea),
quien salga primero cobra de más. **Hecho que lo mata:** `_report` sólo puede mover
`totalDebt` vía `_lendValue`, y `lend()` está guardado por `whenNotEmergency`,
`isActiveStrategy` y el ratio-check de `enforceChangeLimit` (una sola vez desactivado,
`Vault.sol:1138-1141`), de modo que el delta por llamada está acotado por
`profitLimitRatio` bajo `minCheckedStrategyTotalDebt` (1000e18 live); además
`_report` se dispara junto a un `lend` real (aportación de valor 1:1), no como un
incremento artificial de deuda. No encontré secuencia permissionless con delta ≫ 0
verificable en el harness ⇒ **no se reporta como crítico**.

---

## Superficie revisada y descartada explícitamente

* **Proxy admin / `delegatecall`** (`Vault.fallback` + `VaultStorage.setAdminImpl`):
  `sstore` de slot fijo, `setAdminImpl` es `onlyGovOrDelegate`, `VaultAdmin` es
  *delegatecall-only* (si se llama directo escribe en su propio storage, sin efecto).
  No hay `onlyDelegatecall` ⇒ no explotable por sí mismo. **No crítico.**
* **Inicializadores** (`Vault`, `PegToken`, `VaultBuffer`, `Treasury`, `Dripper`,
  `Harvester`, `AccessControlProxy`): todos `initializer`. Un impl sin inicializar puede
  ser "inicializado" por un tercero, pero **es un impl vacío por diseño** (el estado vive
  en el proxy) ⇒ excluido por la regla "impl/proxy vacíos".
* **`AccessControl`**: `BocRoles.GOV_ROLE = 0x00` = `DEFAULT_ADMIN_ROLE` de OZ — es
  intencional, y `addRole` exige `govOrDelegate` + rol vacío. Sin escalada.
* **`ExchangeAggregator.swap/batchSwap`** son permissionless a propósito: el
  `safeTransferFrom(msg.sender, platform, amount)` exige que el llamante tenga los
  tokens y los haya aprobado; no hay saldo propio del agregador. **No crítico.**
* **`Vault.mint` cross-asset / tipo oráculo**: `_estimateMint` y
  `_calculateAssetValue` escalan con `trackedAssetDecimalsMap[_asset]`, fijado en
  `addAsset` vía `Helpers.getDecimals` (rechaza 0) y usado también por el oráculo
  (`getAssetUnit`), es decir **la misma fuente de decimales para precio y balance** ⇒
  sin desajuste explotable. Los 6 vs 18 decimales se validaron en el harness
  (USDT/USDC 6, DAI 18, 1:1 exacto).
* **`PegToken`**: `transfer`/`transferFrom` con atajo `senderBalance == _amount`
  (todo-o-nada, sin resto); `mintShares`/`burnShares` `onlyVault`. `WrappedPegToken`
  mide en shares 1:1, sin amplificación.
* **`Treasury`, `Harvester.transferToken`, `Dripper.transferToken`,
  `VaultAdmin.*`, `ChainlinkPriceFeed.*`, `ValueInterpreter.set*`,
  `AggregatedDerivativePriceFeed.*`**: todos `onlyRole(GOV)`/`isVaultManager`/
  `onlyGovOrDelegate` ⇒ fuera de alcance por privilegiados.
* **`ChainlinkPriceFeed`**: staleness validada en lectura (`__validateRateIsNotStale`),
  `rate<=0 → (0,false) → revert "Invalid rate"` (falla cerrado), aritmética con dos
  multiplicaciones consecutivas (sin overflow con precios reales). Sin hallazgo.
* **`Verification`, `RevertReasonParser`, `LibLinkedList`, `LibRankedList`,
  `WadRayMath`, `SafeUint128`, `Mock*`**: sin ruta de valor (mocks/huérfanas; `MockVault`
  y `MockStrategy` son mocks de test). **No crítico.**

---

## Artefactos

* `audit/poc/` — harness reproducible (compilación + EVM + PoC + fuzz).
* `audit/poc/poc.js` — PoC de C-1 (salida arriba).
* `audit/poc/fuzz3.js` — comparativa *unguarded* vs *guarded* (PnL por usuario).
* `audit/poc/out.json` — ABIs + bytecode compilados de `contracts/` (solc 0.8.17, opt 200).

Reproducir:

```bash
cd audit/poc && npm i && node compile.js && node build_mocks.js && node build_strat.js
node poc.js
node fuzz3.js 3 150 unguarded && node fuzz3.js 3 150 guarded
```
