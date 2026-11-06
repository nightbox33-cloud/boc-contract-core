const solc=require('solc');const fs=require('fs');
const src = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface IERC20M {
  function balanceOf(address) external view returns(uint256);
  function transfer(address,uint256) external returns(bool);
  function transferFrom(address,address,uint256) external returns(bool);
}
interface IVaultM {
  function valueInterpreter() external view returns(address);
  function accessControlProxy() external view returns(address);
  function report(address[] memory, uint256[] memory) external;
}
interface IVI { function calcCanonicalAssetValueInUsd(address,uint256) external view returns(uint256); }

// A strategy whose 'position' is simply the tokens it holds, plus a virtual
// value we can set to simulate yield. estimatedTotalAssets = tokenValue + virtualProfit.
contract StrategyMock {
    address public vault;
    address public harvester;
    address public valueInterpreter;
    address public accessControlProxy;
    address[] public wants;
    uint16 public protocol;
    string public name;
    bool public isWantRatioIgnorable;
    int256 public virtualPnl;      // can be negative
    bool public rug;

    function initialize(address _vault, address[] memory _wants) external {
        vault=_vault; wants=_wants; name="Mock"; protocol=1;
        valueInterpreter = IVaultM(_vault).valueInterpreter();
        accessControlProxy = IVaultM(_vault).accessControlProxy();
    }
    function getVersion() external pure returns(string memory){return "1";}
    function setVirtualPnl(int256 v) external { virtualPnl = v; }
    function setRug(bool v) external { rug = v; }
    function getWants() external view returns(address[] memory){return wants;}
    function getWantsInfo() external view returns(address[] memory, uint256[] memory){
        uint256[] memory r = new uint256[](wants.length);
        for(uint256 i=0;i<wants.length;i++) r[i]=1;
        return (wants, r);
    }
    function getOutputsInfo() external view returns(IOutputInfo[] memory o){}
    struct IOutputInfo { uint256 outputCode; address[] outputTokens; }
    function getPositionDetail() external view returns(address[] memory t, uint256[] memory a, bool u, uint256 v){
        t = wants; a = new uint256[](wants.length);
        for(uint256 i=0;i<wants.length;i++) a[i]=IERC20M(wants[i]).balanceOf(address(this));
        u=false;
    }
    function estimatedTotalAssets() external view returns(uint256 v){
        uint256 tot;
        for(uint256 i=0;i<wants.length;i++){
            tot += IVI(valueInterpreter).calcCanonicalAssetValueInUsd(wants[i], IERC20M(wants[i]).balanceOf(address(this)));
        }
        if(virtualPnl >= 0) tot += uint256(virtualPnl);
        else {
            uint256 l = uint256(-virtualPnl);
            tot = tot > l ? tot - l : 0;
        }
        return tot;
    }
    function get3rdPoolAssets() external view returns(uint256){return type(uint256).max;}
    function poolQuota() external view returns(uint256){return type(uint256).max;}
    function harvest() external returns(address[] memory a, uint256[] memory b){
        a = new address[](0); b = new uint256[](0);
        IVaultM(vault).report(a,b);
    }
    function borrow(address[] memory _assets, uint256[] memory _amounts) external {
        require(msg.sender==vault,"only vault");
    }
    function repay(uint256 _repayShares, uint256 _totalShares, uint256) external returns(address[] memory a, uint256[] memory amts){
        require(msg.sender==vault,"only vault");
        a = wants; amts = new uint256[](wants.length);
        for(uint256 i=0;i<wants.length;i++){
            uint256 bal = IERC20M(wants[i]).balanceOf(address(this));
            uint256 out = (bal * _repayShares)/_totalShares;
            if (rug) out = out/2;               // simulate partial loss on withdraw
            amts[i] = out;
            if(out>0) IERC20M(wants[i]).transfer(vault, out);
        }
    }
}`;
const input={language:'Solidity',sources:{'mocks/StrategyMock.sol':{content:src}},
 settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input)));
for(const e of out.errors||[]) if(e.severity==='error') console.log('ERR', e.formattedMessage);
fs.writeFileSync(require('path').join(__dirname,'strat.json'), JSON.stringify(out));
console.log('ok');
