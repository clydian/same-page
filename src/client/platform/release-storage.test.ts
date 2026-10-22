import { Blob as NodeBlob } from 'node:buffer';
import { expect,it } from 'vitest';
import Dexie from 'dexie';
import { SamePageDatabase } from './local-database';
it('preserves every persistent store across same-contract channel handovers, including unsynced identity and Blob bytes',async()=>{
 const name='release-contract-'+crypto.randomUUID();
 let db=new SamePageDatabase(name);
 try{
  await db.open();
  // Keys are table-specific; generic raw rows preserve the exact serialization contract.
  for(const table of db.tables){
   const row={key:'fixture',opId:'same-attempted-operation',scopeKey:'user:u:c:s',ownerKey:'user:u',choirId:'c',scoreId:'s',id:'fixture',state:'pending',attemptedAt:1,createdAt:1,value:'draft',blob:new NodeBlob(['pdf-bytes']),payload:{kind:'text',pageNumber:1,x:.2,y:.3,fontScale:.024,text:'unsynced'}};
   await table.put(row);
  }
  const before=await Promise.all(db.tables.map(t=>t.toArray()));db.close();
  // Stage beta, then stable, then beta using the frozen contract, never a fresh database name.
  for(let i=0;i<3;i++){
   db=new SamePageDatabase(name);await db.open();
   expect(await Promise.all(db.tables.map(t=>t.toArray()))).toEqual(before);
   const row=await db.system.get('fixture');expect(await row!.blob!.text()).toBe('pdf-bytes');db.close();
  }
 }finally{db.close();await Dexie.delete(name)}
});
