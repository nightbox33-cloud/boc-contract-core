const S=require('./setup.js'); const A=require('./account.js');
const {E,ABI,U,big}=S; const F=A.F;
(async()=>{
 const vm=await E.newVM(); const s=await S.build(vm); const {W}=s;
 // mint 2e9 USDT to gov via the mock's mint
 await E.send(vm,W.gov,s.usdt,ABI.erc20(),'mint',[W.gov.hex, U('3000000000',6).toString()]);
 await E.send(vm,W.gov,s.usdt,ABI.erc20(),'transfer',[s.dripper, U('2000000000',6).toString()]);
 console.log('dripper balance', F(await big(vm,W.gov.addr,s.usdt,ABI.erc20(),'balanceOf',[s.dripper]),6));
 let err=null;
 try{ await E.send(vm,W.gov,s.dripper,E.art('Dripper').abi,'setDripDuration',[1]); }catch(e){ err=e.message; }
 console.log('setDripDuration(1):', err? 'REVERT -> '+err.slice(0,90) : 'OK (uint192 truncation happened)');
 if(!err){
   const raw = Buffer.from(await E.call(vm,W.gov.addr,s.dripper,E.art('Dripper').abi,'availableFunds',[])).toString('hex');
   console.log('availableFunds immediately after =', F(BigInt('0x'+raw),6));
 }
 // also: non-keeper attacker calls collect() right after a big deposit
 err=null;
 const victimBal = await big(vm,W.gov.addr,s.usdt,ABI.erc20(),'balanceOf',[W.gov.hex]);
 try{ await E.send(vm,W.att,s.dripper,E.art('Dripper').abi,'collect',[]); }catch(e){ err=e.message; }
 console.log('permissionless collect() ->', err? 'REVERT '+err.slice(0,60):'OK');
})().catch(e=>console.log('FAIL',e.message));
