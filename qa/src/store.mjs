import crypto from 'node:crypto';
export class Store{
 constructor(db){this.db=db}
 async init(){await this.db.query(`CREATE TABLE IF NOT EXISTS paqa_candidates(id UUID PRIMARY KEY,created_at TIMESTAMPTZ DEFAULT NOW(),target TEXT NOT NULL,version TEXT NOT NULL,patch TEXT NOT NULL,patch_hash TEXT NOT NULL,suites JSONB NOT NULL);
 CREATE TABLE IF NOT EXISTS paqa_jobs(id UUID PRIMARY KEY,candidate_id UUID NOT NULL REFERENCES paqa_candidates(id),stage TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',payload JSONB NOT NULL,lease_token UUID,lease_until TIMESTAMPTZ,attempts INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(candidate_id,stage));
 CREATE TABLE IF NOT EXISTS paqa_approvals(candidate_id UUID PRIMARY KEY REFERENCES paqa_candidates(id),approved_at TIMESTAMPTZ DEFAULT NOW(),note TEXT NOT NULL);`)}
 async list(){return (await this.db.query(`SELECT c.id,c.created_at,c.target,c.version,c.patch_hash,(SELECT jsonb_agg(jsonb_build_object('stage',j.stage,'status',j.status,'summary',j.payload->'summary','completed',jsonb_array_length(j.payload->'results'),'total',j.payload->'total','calls',j.calls,'error',j.payload->'error') ORDER BY j.created_at) FROM paqa_jobs j WHERE j.candidate_id=c.id) AS jobs,EXISTS(SELECT 1 FROM paqa_approvals a WHERE a.candidate_id=c.id) AS approved FROM paqa_candidates c ORDER BY c.created_at DESC LIMIT 50`)).rows}
 async claim(){
  await this.db.query(`UPDATE paqa_jobs SET status='interrupted',updated_at=NOW(),payload=payload||'{"error":"Worker recovery limit reached"}'::jsonb WHERE status='running' AND lease_until<NOW() AND attempts>=3`);
  const token=crypto.randomUUID();
  const r=await this.db.query(`UPDATE paqa_jobs SET status='running',lease_token=$1,lease_until=NOW()+INTERVAL '2 minutes',attempts=attempts+1,updated_at=NOW() WHERE id=(SELECT id FROM paqa_jobs WHERE status='queued' OR (status='running' AND lease_until<NOW() AND attempts<3) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[token]);
  return r.rows[0]||null;
 }
 async renew(j){const r=await this.db.query(`UPDATE paqa_jobs SET lease_until=NOW()+INTERVAL '2 minutes' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id`,[j.id,j.lease_token]);if(!r.rowCount)throw Error('Worker lease lost')}
 async spend(j){const r=await this.db.query(`UPDATE paqa_jobs SET calls=calls+1 WHERE id=$1 AND lease_token=$2 AND status='running' AND calls<240 RETURNING calls`,[j.id,j.lease_token]);if(!r.rowCount)throw Error('Call limit reached or worker lease lost')}
 async save(j,status='running'){const r=await this.db.query(`UPDATE paqa_jobs SET payload=$3,status=$4,updated_at=NOW() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id`,[j.id,j.lease_token,JSON.stringify(j.payload),status]);if(!r.rowCount)throw Error('Worker lease lost')}
}
