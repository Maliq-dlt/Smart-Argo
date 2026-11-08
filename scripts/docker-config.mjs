import { randomBytes, createHmac } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const dir='/run/smart-agro'
await mkdir(dir,{recursive:true})
let settings
try {settings=JSON.parse(await readFile(`${dir}/settings.json`,'utf8'))}
catch(error) {
  if(error.code !== 'ENOENT') throw error
  const password=randomBytes(32).toString('hex'), secret=randomBytes(48).toString('hex')
  const token=role=>{
    const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
    const body=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+10*365*86400})).toString('base64url')
    const data=`${head}.${body}`
    return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`
  }
  settings={password,secret,anon:token('anon'),service:token('service_role')}
  await writeFile(`${dir}/settings.json`,JSON.stringify(settings),{mode:0o600,flag:'wx'})
}
if(!/^[a-f0-9]{64}$/.test(settings.password) || !/^[a-f0-9]{96}$/.test(settings.secret)) throw new Error('Invalid persisted Docker configuration')
await writeFile(`${dir}/db-password`,settings.password,{mode:0o644})
await writeFile(`${dir}/auth.env`,`export GOTRUE_DB_DATABASE_URL='postgres://postgres:${settings.password}@db:5432/postgres?search_path=auth'\nexport GOTRUE_JWT_SECRET='${settings.secret}'\n`,{mode:0o644})
await writeFile(`${dir}/postgrest.conf`,`db-uri = "postgres://postgres:${settings.password}@db:5432/postgres"\njwt-secret = "${settings.secret}"\ndb-schemas = "public"\ndb-anon-role = "anon"\ndb-max-rows = 100\n`,{mode:0o644})
console.log('Local Docker configuration ready; existing keys preserved.')
