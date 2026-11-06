# PoC ejecutable — auditoría boc-contract-core @ 8efa17a (develop v1.9.5)

Todo se ejecuta contra el **bytecode real** compilado de `contracts/` (solc 0.8.17,
optimizer 200, yul) en una EVM local (`@ethereumjs/vm`), sin `deal`, sin mocks de
protocolo: solo ERC20/Aggregator/Strategy *test doubles* que implementan las
interfaces que el código espera.

## Instalación

```bash
cd audit/poc
npm init -y >/dev/null
npm i solc@0.8.17 @openzeppelin/contracts@4.5.0 \
      @openzeppelin/contracts-upgradeable@4.5.2 @chainlink/contracts@0.2.1 \
      @ethereumjs/vm@6.5.0 @ethereumjs/common@3.2.0 @ethereumjs/tx@4 \
      @ethereumjs/util@8 @ethereumjs/block@4 ethereum@5.8.0 ethers@5.8.0
```

## Ejecución

```bash
node compile.js     # compila contracts/ -> out.json
node build_mocks.js # ERC20Mock + AggregatorMock -> mocks.json
node build_strat.js # StrategyMock -> strat.json
node poc.js         # PoC del hallazgo
node fuzz2.js 1 150 # fuzz de invariantes (mint/burn/adjust/distribute/rebase/lend)
```

`poc.js` imprime el PnL de cada actor. Salida esperada (resumida):

```
[2] usuario B deposita 500,000 USDT fuera de ronda (estado normal)
    B: tUSDi = 500000.0  (recibo 1:1)
    buffer cash = 500000.0 isDistributing = false
[3] keeper invoca distributeWhenDistributing()
    B: tUSDi = 0.0   USDi recibido = 0.0    <-- recibo quemado, 0 pagado
    buffer cash sigue en 500000.0 USDT (huerfano)
[4] atacante C deposita 1 USDT y espera el siguiente ciclo normal
    C: deposito 1 USDT -> USDi = 500001.0
  att  puso  0.000001  ->  reclama  500000.999999  PnL = +500000.999999
  u2   puso  0.5       ->  reclama  0.0            PnL = -500000
```
