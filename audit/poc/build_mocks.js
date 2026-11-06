const solc=require('solc');const fs=require('fs');
const srcs = {
 'mocks/ERC20Mock.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract ERC20Mock {
    string public name; string public symbol; uint8 public decimals;
    uint256 public totalSupply;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor(string memory n,string memory s,uint8 d,uint256 supply){name=n;symbol=s;decimals=d;totalSupply=supply;balanceOf[msg.sender]=supply;emit Transfer(address(0),msg.sender,supply);}
    function transfer(address to,uint256 v) external returns(bool){_t(msg.sender,to,v);return true;}
    function approve(address s,uint256 v) external returns(bool){allowance[msg.sender][s]=v;emit Approval(msg.sender,s,v);return true;}
    function transferFrom(address f,address to,uint256 v) external returns(bool){
        uint256 a=allowance[f][msg.sender]; require(a>=v,'allow'); if(a!=type(uint256).max) allowance[f][msg.sender]=a-v; _t(f,to,v); return true;}
    function _t(address f,address to,uint256 v) internal {require(balanceOf[f]>=v,'bal'); balanceOf[f]-=v; balanceOf[to]+=v; emit Transfer(f,to,v);}
    function mint(address to,uint256 v) external {totalSupply+=v;balanceOf[to]+=v;emit Transfer(address(0),to,v);}
    function burn(address from,uint256 v) external {require(balanceOf[from]>=v,'bal');balanceOf[from]-=v;totalSupply-=v;emit Transfer(from,address(0),v);}
}`,
 'mocks/ChainlinkAggregatorMock.sol': `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract AggregatorMock {
    int256 public answer; uint256 public updatedAt; uint80 public roundId=1;
    constructor(int256 a){answer=a;updatedAt=block.timestamp;}
    function set(int256 a) external {answer=a;updatedAt=block.timestamp;roundId++;}
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80){return(roundId,answer,updatedAt,updatedAt,roundId);}
    function decimals() external pure returns(uint8){return 8;}
}`
};
const sources={};
for(const k of Object.keys(srcs)) sources[k]={content:srcs[k]};
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input)));
for(const e of out.errors||[]) if(e.severity==='error') console.log('ERR',e.formattedMessage);
require('fs').writeFileSync(require('path').join(__dirname,'mocks.json'), JSON.stringify(out));
console.log('mocks built', Object.keys(out.contracts||{}));
