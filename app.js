'use strict';
(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const C=window.SEN_CONFIG||{}; const configured=/^https:\/\/[^/]+\.supabase\.co\/?$/.test(C.url||'') && /^(sb_publishable_|eyJ)/.test(C.publishableKey||'');
const STAGES={recibido:'Evento recibido',edan:'En proceso de EDAN',completado:'Completado'};
const COLORS={recibido:'#cf414b',edan:'#e49b23',completado:'#279464'};
const FIELD_LABEL={expediente:'N.º expediente interno SEN',asunto:'Asunto',institucion:'Institución remitente',nota:'Número de nota',envio:'Fecha de envío',localidad:'Localidad',pedido:'Pedido – detalle',evento:'Evento',afectados:'Personas afectadas',estatus:'Estatus original',responsable:'Responsable',observaciones:'Observaciones',cargado:'Cargado sí/no'};
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const html=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const isoDate=s=>{const v=String(s||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const a=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);return a?`${a[3]}-${a[2].padStart(2,'0')}-${a[1].padStart(2,'0')}`:null};
const Z=window.SEN_ZONES, depts=Z.departamentos.features, districts=Z.distritos.features;
const zkey=(kind,p)=>`${kind}|${norm(p.departamento)}|${norm(p.nombre)}`;
const zoneFeat=new Map([...districts.map(f=>[zkey('distrito',f.properties),f]),...depts.map(f=>[zkey('departamento',f.properties),f])]);
const districtAliases=districts.map(f=>({key:zkey('distrito',f.properties),name:norm(f.properties.nombre),dep:norm(f.properties.departamento)}));
const deptAliases=depts.map(f=>({key:zkey('departamento',f.properties),name:norm(f.properties.nombre)}));
function matchZone(localidad){const t=norm(localidad);if(!t)return '';
 const dp=deptAliases.filter(d=>t.includes(d.name));
 const ds=districtAliases.filter(d=>d.name.length>=4&&(` ${t} `).includes(` ${d.name} `));
 const filtered=dp.length?ds.filter(d=>dp.some(p=>p.name===d.dep)):ds;
 const candidates=filtered.length?filtered:ds;
 if(candidates.length){candidates.sort((a,b)=>b.name.length-a.name.length);const best=candidates[0];if(candidates.some(c=>c!==best&&c.name===best.name&&c.dep!==best.dep))return '';return best.key}
 return dp.length===1?dp[0].key:'';
}
let client=null,profile=null,events=[],audits=[],profiles=[],publicZones=[],selectedZone='',view={x:62,y:83,w:1040,h:980},drag=null,dragged=false,editing=null;
const base={x:62,y:83,w:1040,h:980};
const msg=(s,bad=false)=>{const e=$('#notice');e.textContent=s;e.hidden=false;e.className=bad?'notice error':'notice';};
const staff=()=>!!profile&&['admin','operator'].includes(profile.role)&&profile.active;
const admin=()=>staff()&&profile.role==='admin';
function nav(p){$$('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$$('.page').forEach(x=>x.hidden=x.id!==p);if(p==='mapa')renderMap();if(p==='registros')renderTable();if(p==='usuarios')renderUsers();if(p==='nuevo')$('#event-form').reset();window.scrollTo(0,0)}
function applyRole(){const logged=!!profile;$('#login-trigger').hidden=logged;$('#signout').hidden=!logged;$('#profile-label').textContent=logged?`${profile.full_name||profile.email} · ${profile.role==='admin'?'Administrador':'Operador'}`:'Visitante';
 $$('[data-staff]').forEach(e=>e.hidden=!staff());$$('[data-admin]').forEach(e=>e.hidden=!admin());
 if(!staff()&&['registros','nuevo','importar','usuarios'].some(id=>!$('#'+id).hidden))nav('mapa');
 $('#loginbox').hidden=true;
}
async function openLogin(){if(!configured){msg('Configurá config.js con URL y clave publicable de Supabase antes de iniciar sesión.',true);return}$('#loginbox').hidden=false;$('#email').focus()}
async function loadProfile(){const {data:{user},error}=await client.auth.getUser();if(error||!user){profile=null;applyRole();return}
 const r=await client.from('profiles').select('id,email,full_name,role,active').eq('id',user.id).maybeSingle();
 if(r.error||!r.data||!r.data.active||!['admin','operator'].includes(r.data.role)){profile=null;await client.auth.signOut();msg('La cuenta todavía no está habilitada por un administrador.',true)}else profile=r.data;
 applyRole();
}
async function loadPublic(){if(!client)return;
 const {data,error}=await client.from('public_event_zones').select('zone_key,estado').limit(10000);
 if(error){msg('No se pudo leer el mapa público: '+error.message,true);return}
 publicZones=data||[];renderMap();
}
async function loadPrivate(){if(!staff()){events=[];audits=[];profiles=[];return}
 const [r,a,p]=await Promise.all([client.from('events').select('*').order('created_at',{ascending:false}).limit(10000),client.from('event_audit').select('id,event_id,actor,action,before_data,after_data,created_at').order('created_at',{ascending:false}).limit(10000),client.from('profiles').select('id,email,full_name,role,active').limit(10000)]);
 if(r.error||a.error||p.error){msg('Error al consultar los registros privados: '+(r.error||a.error||p.error).message,true);return}
 events=r.data||[];audits=a.data||[];profiles=p.data||[];
 renderTable();renderMap();if(admin())renderUsers();
}
async function refresh(){await loadPublic();await loadPrivate();}
// Cartografía vectorial offline heredada de GEOlab–SEN v26.
const point=(lon,lat)=>[(lon+64)*95,(-lat-18)*95];
function geoPath(g){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates||[];return polys.map(poly=>poly.map(ring=>ring.map((p,i)=>{const [x,y]=point(p[0],p[1]);return(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ')+'Z').join(' ')).join(' ')}
function svgNode(n,a={}){const el=document.createElementNS('http://www.w3.org/2000/svg',n);for(const [k,v] of Object.entries(a))el.setAttribute(k,v);return el}
function setView(){const svg=$('#geo');svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`)}
function zoom(scale,cx=view.x+view.w/2,cy=view.y+view.h/2){const w=Math.max(105,Math.min(1450,view.w*scale));const h=w*base.h/base.w;view={x:cx-(cx-view.x)*w/view.w,y:cy-(cy-view.y)*h/view.h,w,h};setView()}
function renderMap(){const svg=$('#geo');svg.replaceChildren();const counts=new Map();
 for(const z of publicZones){if(!counts.has(z.zone_key))counts.set(z.zone_key,{recibido:0,edan:0,completado:0});if(STAGES[z.estado])counts.get(z.zone_key)[z.estado]++}
 const bg=svgNode('rect',{x:base.x,y:base.y,width:base.w,height:base.h,fill:'#e8f2f7'});svg.append(bg);
 for(const f of depts)svg.append(svgNode('path',{d:geoPath(f.geometry),fill:'#e4ece4',stroke:'#728e99','stroke-width':'1.5','vector-effect':'non-scaling-stroke'}));
 for(const f of districts){const key=zkey('distrito',f.properties),stat=counts.get(key);const stage=stat?(stat.recibido?'recibido':stat.edan?'edan':'completado'):'';const p=svgNode('path',{d:geoPath(f.geometry),fill:stage?COLORS[stage]:'#f0f4ee','fill-opacity':stage?'0.72':'0.85',stroke:key===selectedZone?'#113f5a':'#91aa9c','stroke-width':key===selectedZone?'3.5':'.6','vector-effect':'non-scaling-stroke','data-zone':key,tabindex:stat?'0':'-1'});if(stat){p.style.cursor='pointer';p.addEventListener('click',()=>selectZone(key));p.addEventListener('keydown',e=>{if(e.key==='Enter')selectZone(key)})}svg.append(p)}
 for(const f of depts){const key=zkey('departamento',f.properties),stat=counts.get(key);if(!stat)continue;const stage=stat.recibido?'recibido':stat.edan?'edan':'completado';const p=svgNode('path',{d:geoPath(f.geometry),fill:COLORS[stage], 'fill-opacity':'.25',stroke:key===selectedZone?'#07394d':COLORS[stage],'stroke-width':key===selectedZone?'3.5':'1.7','vector-effect':'non-scaling-stroke',class:'zone'});p.addEventListener('click',()=>selectZone(key));svg.append(p)}
 setView();$('#public-count').textContent=publicZones.length+' registros ubicados en zonas (información general)';renderSelection(counts);
}
function selectZone(k){selectedZone=k;renderMap();const panel=$('#zone-panel');panel.scrollIntoView({behavior:'smooth',block:'nearest'})}
function renderSelection(counts){const wrap=$('#zone-panel');wrap.replaceChildren();if(!selectedZone){wrap.innerHTML='<h3>Seleccioná una zona</h3><p>Hacé clic en un distrito coloreado. Los visitantes solo ven información general.</p>';return}
 const f=zoneFeat.get(selectedZone);if(!f){selectedZone='';return}const a=counts.get(selectedZone)||{recibido:0,edan:0,completado:0};const title=document.createElement('h3');title.textContent=f.properties.nombre+' · '+f.properties.departamento;wrap.append(title);
 const summary=document.createElement('p');summary.textContent=`Recibidos: ${a.recibido} · En EDAN: ${a.edan} · Completados: ${a.completado}`;wrap.append(summary);
 if(!staff()){const t=document.createElement('p');t.className='muted';t.textContent='Vista pública: no se muestran expedientes ni información personal.';wrap.append(t);return}
 const related=events.filter(e=>e.zone_key===selectedZone);if(!related.length){wrap.append('No hay registros privados asociados a esta zona.');return}
 for(const e of related){const b=document.createElement('button');b.className='zone-item';b.textContent=`${e.expediente} · ${e.evento||'Evento'} · ${STAGES[e.estado]}`;b.addEventListener('click',()=>openEdit(e.id));wrap.append(b)}
}
// Fichas privadas: nunca se consultan para el visitante.
function filtered(){const q=norm($('#search').value),s=$('#filter-state').value,from=$('#date-from').value,to=$('#date-to').value;return events.filter(e=>(!s||e.estado===s)&&(!from||e.recepcion>=from)&&(!to||e.recepcion<=to)&&(!q||norm([e.expediente,e.evento,e.localidad,JSON.stringify(e.details)].join(' ')).includes(q)))}
function renderTable(){const tb=$('#table-body');tb.replaceChildren();if(!staff())return;const rows=filtered();$('#table-count').textContent=rows.length+' registro(s)';
 for(const e of rows){const tr=document.createElement('tr');for(const val of [e.recepcion||'—',e.expediente,e.evento||'—',e.localidad||'—',STAGES[e.estado]]){const c=document.createElement('td');c.textContent=val;tr.append(c)}const td=document.createElement('td'),btn=document.createElement('button');btn.textContent='Abrir ficha';btn.onclick=()=>openEdit(e.id);td.append(btn);tr.append(td);tb.append(tr)}
}
function getFields(form){const d=Object.fromEntries(new FormData(form));for(const k in d)d[k]=String(d[k]).trim();return d}
function serialize(d){const keep={};for(const k of Object.keys(FIELD_LABEL)){if(!['expediente','evento','localidad'].includes(k))keep[k]=d[k]||''}return {expediente:d.expediente,evento:d.evento||'',localidad:d.localidad||'',zone_key:d.zone_key||matchZone(d.localidad),estado:d.estado||'recibido',recepcion:isoDate(d.recepcion),details:keep}}
function fillZoneSelect(el,value){el.replaceChildren(new Option('Ubicación pendiente de revisar',''));for(const [key,f] of zoneFeat)el.append(new Option(`${f.properties.nombre} · ${f.properties.departamento}`,key));el.value=value||''}
function populate(form,d){for(const el of form.elements){if(!el.name)continue;if(el.name==='zone_key')continue;el.value=(d[el.name]??'')};fillZoneSelect(form.elements.namedItem('zone_key'),d.zone_key||matchZone(d.localidad));}
async function createEvent(e){e.preventDefault();if(!staff())return;const d=getFields(e.currentTarget),body=serialize(d);if(!body.expediente){msg('Ingresá un número de expediente',true);return}
 const r=await client.from('events').insert(body).select('id').single();if(r.error){msg('No se pudo guardar: '+r.error.message,true);return}e.currentTarget.reset();msg('Expediente creado y guardado en la base de datos.');await refresh();nav('registros')}
function openEdit(id){if(!staff())return;const r=events.find(e=>e.id===id);if(!r)return;editing=id;const values={...r.details,expediente:r.expediente,evento:r.evento,localidad:r.localidad,estado:r.estado,recepcion:r.recepcion||'',zone_key:r.zone_key};populate($('#edit-form'),values);$('#edit-title').textContent='Ficha · '+r.expediente;renderAudit(id);$('#modal').hidden=false;$('#edit-form').querySelector('[name=expediente]').focus()}
function renderAudit(id){const wrap=$('#audit');wrap.replaceChildren();const r=events.find(e=>e.id===id);const old=[...(Array.isArray(r?.details?.migrated_history)?r.details.migrated_history:[]),...(Array.isArray(r?.details?.migrated_audit)?r.details.migrated_audit:[])];if(old.length){const h=document.createElement('p');h.textContent=`Historial importado de origen: ${old.length} actuación(es)`;wrap.append(h);for(const item of old){const p=document.createElement('p');p.className='audit-item';p.textContent=(item.fecha||'')+' · '+(item.detalle||item.tipo||'Actuación de origen');wrap.append(p)}}
 for(const x of audits.filter(a=>a.event_id===id).reverse()){const actor=profiles.find(p=>p.id===x.actor);const p=document.createElement('p');p.className='audit-item';let diff='';if(x.before_data){const before=x.before_data,after=x.after_data;const pieces=[];for(const field of ['estado','expediente','evento','localidad','recepcion','zone_key'])if(JSON.stringify(before[field])!==JSON.stringify(after[field]))pieces.push(field+': '+String(before[field]??'')+' → '+String(after[field]??''));for(const field of Object.keys(after.details||{})){if(JSON.stringify(before.details?.[field])!==JSON.stringify(after.details?.[field]))pieces.push(field+': modificado')}diff=pieces.join(' | ')}
 p.textContent=`${new Date(x.created_at).toLocaleString('es-PY')} · ${actor?.full_name||'Usuario'} · ${x.action} ${diff}`;wrap.append(p)}
}
async function saveEdit(e){e.preventDefault();if(!staff()||!editing)return;const d=getFields(e.currentTarget),body=serialize(d);const r=await client.from('events').update(body).eq('id',editing).select('id').single();if(r.error){msg('No se pudieron guardar los cambios: '+r.error.message,true);return}await refresh();$('#modal').hidden=true;msg('Cambios guardados en Supabase. El historial se registró automáticamente.')}
function parseCSV(text){text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0]||'';const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(!quoted&&c===sep){row.push(cell);cell=''}else if(!quoted&&(c==='\r'||c==='\n')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}else cell+=c}
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(rows.length<2)throw Error('CSV vacío o sin datos');return rows}
const ALIASES={expediente:['NRO DE EXPEDIENTE INTERNO SEN','N DE EXPEDIENTE INTERNO SEN','N DE EXPEDIENTE INTERNO','EXPEDIENTE','NUMERO DE EXPEDIENTE','NRO EXPEDIENTE'],asunto:['ASUNTO'],institucion:['INSTITUCION REMITENTE'],nota:['NUMERO DE NOTA','NRO DE NOTA'],recepcion:['FECHA DE RECEPCION SEN','FECHA RECEPCION SEN','FECHA DE RECEPCION'],envio:['FECHA DE ENVIO DEL REMITENTE','FECHA DE ENVIO'],localidad:['LOCALIDAD','UBICACION'],pedido:['PEDIDO DETALLE','PEDIDO'],evento:['EVENTO','TIPO DE EVENTO'],afectados:['PERSONAS AFECTADAS'],estatus:['ESTATUS','ESTADO ORIGINAL'],cargado:['CARGADO SI NO'],estado:['ESTADO OPERATIVO'],responsable:['RESPONSABLE'],observaciones:['OBSERVACIONES'],zone_key:['ZONA ADMINISTRATIVA']};
function importedRows(matrix){const head=matrix[0].map(norm);const byKey=Object.fromEntries(Object.entries(ALIASES).map(([key,arr])=>[key,head.findIndex(h=>arr.includes(h))]));if(byKey.expediente<0)throw Error('No se encontró la columna de número de expediente');const out=[];for(const row of matrix.slice(1)){const r={};for(const [k,i] of Object.entries(byKey))r[k]=i>=0?String(row[i]||'').trim():'';if(!r.expediente)continue;r.estado=['recibido','edan','completado'].includes(r.estado)?r.estado:'recibido';out.push(serialize(r))}return out}
let pendingImport=[];
async function inspectFile(file){if(!file)return;try{if(!file.name.toLowerCase().endsWith('.csv'))throw Error('Exportá la planilla Excel como CSV UTF-8 antes de cargarla.');pendingImport=importedRows(parseCSV(await file.text()));$('#import-preview').textContent=`${pendingImport.length} filas válidas. Vista previa: ${pendingImport.slice(0,3).map(e=>e.expediente).join(', ')}`;$('#import-commit').disabled=false}catch(e){pendingImport=[];$('#import-commit').disabled=true;msg(e.message,true)}}
async function importCSV(){if(!staff()||!pendingImport.length)return;const existing=new Set(events.map(e=>norm(e.expediente)));let ok=0,skip=0,fail=0;for(const item of pendingImport){if(existing.has(norm(item.expediente))){skip++;continue}const {error}=await client.from('events').insert(item);if(error){fail++;continue}existing.add(norm(item.expediente));ok++}pendingImport=[];$('#import-commit').disabled=true;msg(`Importación terminada: ${ok} nuevos, ${skip} duplicados omitidos, ${fail} errores.` ,fail>0);await refresh()}
async function importJSON(file){if(!file||!staff())return;try{const data=JSON.parse(await file.text());const rows=Array.isArray(data.registros)?data.registros:Array.isArray(data)?data:null;if(!rows)throw Error('No se encontraron registros en el respaldo JSON');if(!confirm(`Se importarán hasta ${rows.length} registros. No se sobrescribirán los existentes. ¿Continuar?`))return;
 const existing=new Set(events.map(e=>norm(e.expediente)));let ok=0,skip=0,failed=0;
 for(const r of rows){if(!r.expediente)continue;if(existing.has(norm(r.expediente))){skip++;continue}const d={...(r.details||{}),...r,zone_key:r.zone_key||matchZone(r.localidad)};const body=serialize(d);if(Array.isArray(r.historial))body.details.migrated_history=r.historial;else if(Array.isArray(r.details?.migrated_history))body.details.migrated_history=r.details.migrated_history;if(Array.isArray(data.auditoria)){const prior=data.auditoria.filter(a=>a.event_id===r.id);if(prior.length)body.details.migrated_audit=prior.map(a=>({fecha:a.created_at,tipo:a.action,detalle:'Actuación previa importada (ver respaldo original)',actor:a.actor,antes:a.before_data,despues:a.after_data}));}const {error}=await client.from('events').insert(body);if(error){failed++;continue}existing.add(norm(r.expediente));ok++}msg(`JSON importado: ${ok} nuevos, ${skip} duplicados, ${failed} errores. Historial previo conservado como historial de origen.` ,failed>0);await refresh();}catch(e){msg('No se pudo importar JSON: '+e.message,true)}}
function download(name,content,type){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function exportJSON(){if(!staff())return;download('GEOlab_SEN_respaldo_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({application:'GEOlab-SEN',version:27,exported_at:new Date().toISOString(),registros:events,auditoria:audits},null,2),'application/json')}
function exportCSV(){if(!staff())return;const cols=['expediente','evento','localidad','estado','recepcion',...Object.keys(FIELD_LABEL).filter(k=>!['expediente','evento','localidad'].includes(k))];const quote=x=>'"'+String(x??'').replace(/"/g,'""')+'"';const rows=[cols,...events.map(e=>cols.map(k=>k in e?e[k]:e.details?.[k]||''))];download('GEOlab_SEN_registros.csv','\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv;charset=utf-8')}
function renderUsers(){if(!admin())return;const el=$('#users-list');el.replaceChildren();for(const p of profiles){const d=document.createElement('p');d.textContent=`${p.full_name||p.email} · ${p.email} · ${p.role} · ${p.active?'Activo':'Inactivo'}`;el.append(d)}}
async function createOperator(e){e.preventDefault();if(!admin())return;const d=getFields(e.currentTarget);const {data,error}=await client.functions.invoke('create-operator',{body:{email:d.email,full_name:d.full_name,password:d.password}});if(error||data?.error){msg('No se pudo crear el operador: '+(data?.error||error?.message||'Error'),true);return}e.currentTarget.reset();msg('Operador creado. Comunicá la contraseña temporal por un canal seguro.');await loadPrivate()}
async function changePassword(e){e.preventDefault();if(!staff())return;const pwd=$('#new-password').value;if(pwd.length<12){msg('La contraseña nueva debe tener al menos 12 caracteres',true);return}const {error}=await client.auth.updateUser({password:pwd});if(error)msg(error.message,true);else{e.currentTarget.reset();msg('Contraseña actualizada')}}
async function init(){fillZoneSelect($('#event-form').elements.namedItem('zone_key'),'');fillZoneSelect($('#edit-form').elements.namedItem('zone_key'),'');
 $$('[data-page]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.page)));
 $('#login-trigger').onclick=openLogin;$('#login-cancel').onclick=()=>$('#loginbox').hidden=true;
 $('#signout').onclick=async()=>{await client.auth.signOut();profile=null;events=[];audits=[];profiles=[];applyRole();nav('mapa');msg('Sesión cerrada.')};
 $('#login-form').onsubmit=async e=>{e.preventDefault();const d=getFields(e.currentTarget);const {error}=await client.auth.signInWithPassword({email:d.email,password:d.password});if(error){msg('Error de acceso: '+error.message,true);return}await loadProfile();await refresh();msg('Sesión iniciada correctamente.')};
 $('#event-form').onsubmit=createEvent;$('#edit-form').onsubmit=saveEdit;$('#modal-close').onclick=()=>$('#modal').hidden=true;
 $('#file-csv').onchange=e=>inspectFile(e.target.files[0]);$('#import-commit').onclick=importCSV;$('#file-json').onchange=e=>importJSON(e.target.files[0]);
 $('#export-csv').onclick=exportCSV;$('#export-json').onclick=exportJSON;$('#create-operator').onsubmit=createOperator;$('#password-form').onsubmit=changePassword;
 ['search','filter-state','date-from','date-to'].forEach(id=>$('#'+id).addEventListener('input',renderTable));
 $('#zoom-in').onclick=()=>zoom(.75);$('#zoom-out').onclick=()=>zoom(1/.75);$('#zoom-reset').onclick=()=>{view={...base};setView()};
 const svg=$('#geo');svg.addEventListener('wheel',e=>{e.preventDefault();const a=svg.createSVGPoint();a.x=e.clientX;a.y=e.clientY;const p=a.matrixTransform(svg.getScreenCTM().inverse());zoom(e.deltaY<0?.85:1.18,p.x,p.y)},{passive:false});
 svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,view:{...view}};dragged=false});
 svg.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>6){dragged=true;svg.classList.add('dragging');view.x=drag.view.x-dx*drag.view.w/svg.clientWidth;view.y=drag.view.y-dy*drag.view.h/svg.clientHeight;setView()}});
 const end=()=>{drag=null;svg.classList.remove('dragging');setTimeout(()=>dragged=false,0)};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 svg.addEventListener('click',e=>{if(dragged){e.stopPropagation();e.preventDefault()}},true);
 svg.addEventListener('dblclick',e=>{e.preventDefault();zoom(.72)});
 $('#refresh').onclick=refresh;
 if(!configured){$('#setup').hidden=false;msg('Configuración pendiente: completá config.js y ejecutá el SQL para activar usuarios.',true);renderMap();return}
 if(!window.supabase){msg('No se cargó la biblioteca de Supabase. Revisá la conexión a Internet.',true);renderMap();return}
 client=window.supabase.createClient(C.url,C.publishableKey);
 await loadProfile();await refresh();
 client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){profile=null;events=[];audits=[];profiles=[];applyRole();renderMap()}})
}
init().catch(e=>msg('Error de inicio: '+e.message,true));
})();
