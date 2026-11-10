import { DatabaseSync, backup } from 'node:sqlite';
import { resolve,join } from 'node:path';
import { mkdirSync } from 'node:fs';
const dir=process.env.LOOM_DATA_DIR || join(process.env.HOME || process.env.USERPROFILE,'.local/share/bookauthor');
const target=resolve(process.argv[2] || `bookauthor-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(join(dir,'loom.sqlite'),{readOnly:true});
await backup(db,target);db.close();console.log(target);
