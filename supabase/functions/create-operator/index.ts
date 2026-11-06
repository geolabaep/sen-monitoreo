// Función de servidor: el secreto nunca se publica en GitHub Pages.
import { createClient } from 'npm:@supabase/supabase-js@2';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:CORS});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return reply(405,{error:'Método no permitido'});
 try{
  const url=Deno.env.get('SUPABASE_URL')!;
  const publishable=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default || Deno.env.get('SUPABASE_ANON_KEY')!;
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization=req.headers.get('authorization')||'';
  const jwt=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!jwt)return reply(401,{error:'Debés iniciar sesión'});
  const adminClient=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:identity,error:identityError}=await adminClient.auth.getUser(jwt);
  if(identityError||!identity.user)return reply(401,{error:'Sesión inválida'});
  const {data:profile,error:profileError}=await adminClient.from('profiles').select('role,active').eq('id',identity.user.id).single();
  if(profileError||profile?.role!=='admin'||profile.active!==true)return reply(403,{error:'Solo el administrador puede crear operadores'});
  let body:any;try{body=await req.json()}catch{return reply(400,{error:'Solicitud inválida'})}
  const email=String(body.email||'').trim().toLowerCase();
  const full_name=String(body.full_name||'').trim();
  const password=String(body.password||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!full_name||full_name.length>120||password.length<12||password.length>128)
   return reply(400,{error:'Ingresá nombre, correo válido y contraseña temporal de al menos 12 caracteres'});
  const {data:created,error:createErr}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name}});
  if(createErr||!created.user)return reply(400,{error:createErr?.message||'No se pudo crear el usuario'});
  const {error:updateErr}=await adminClient.from('profiles').upsert({id:created.user.id,email,full_name,role:'operator',active:true});
  if(updateErr){await adminClient.auth.admin.deleteUser(created.user.id);return reply(500,{error:'No se pudo activar el operador'});}
  return reply(200,{ok:true,email,full_name});
 }catch(e){return reply(500,{error:'Error de servidor al crear operador'});}
});
