/* Dosya seçme akışı: teknik seçilmeden dosya eklenirse ne oluyor? */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const js=fs.readFileSync(__dirname+'/app.js','utf8');
const sayfa=html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>','')
                .replace(/<script src="config\.js[^"]*"><\/script>/,'')
                .replace(/<script src="app\.js[^"]*"><\/script>/,'<script>'+js+'</script>');
const dom=new JSDOM(sayfa,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://o.github.io/arsiv/',
  beforeParse(w){
    w.localStorage.setItem('arsiv-client-id', JSON.stringify('1-a.apps.googleusercontent.com'));
    w.localStorage.setItem('arsiv-kok-id', JSON.stringify('KOK'));
    w.localStorage.setItem('arsiv-son-senk', JSON.stringify(new Date(Date.now()+86400000).toISOString()));
    w.localStorage.setItem('arsiv-dizin-v1', JSON.stringify({ z: Date.now(), kok:'KOK', d:{},
      p:[{d:'KAPAK',h:'TEST HASTA',t:'',g:'H1',v:[{t:'20260101',id:'V1',k:{EKSTERNAL:{id:'T1',n:2}}}]}] }));
    w.google={accounts:{oauth2:{initTokenClient(cfg){ return { callback:cfg.callback,
      requestAccessToken(){ setTimeout(()=>this.callback({access_token:'J',expires_in:3600}),0); } }; }, revoke(){}}}};
    w.fetch=async()=>({ok:true,status:200,headers:{get:()=>'application/json'},json:async()=>({files:[]})}); }});
const w=dom.window,d=w.document,b=m=>new Promise(r=>setTimeout(r,m));
let g=0,k=0; const T=(a,x)=>{console.log((x?'  OK   ':'  HATA ')+a); x?g++:k++;};
function dosyaVer(adlar){
  const f=adlar.map(a=>new w.File([new Uint8Array(1000)],a,{type:'image/jpeg'}));
  const gi=d.getElementById('ndosya');
  Object.defineProperty(gi,'files',{value:f,configurable:true});
  gi.dispatchEvent(new w.Event('change',{bubbles:true}));
}
(async()=>{
  await b(1200);
  T('dosya girdisinde filtre YOK', !d.getElementById('ndosya').getAttribute('accept'));
  T('uygulama acildi', d.getElementById('kapak').hidden===true);
  d.getElementById('tab-yeni').click();
  await b(150);

  console.log('--- teknik SECILMEDEN dosya ekle ---');
  dosyaVer(['a.jpg','b.jpg']);
  await b(120);
  const uyari=d.querySelector('#secilenler .serit.uyari');
  T('uyari gosterildi', !!uyari);
  if(uyari) console.log('     ', uyari.textContent.replace(/\s+/g,' ').slice(0,95));

  console.log('--- sonra teknik sec ---');
  const cip=[...d.querySelectorAll('#ntek .cip')].find(x=>x.textContent==='UWFP');
  T('teknik cipleri cizildi', !!cip);
  cip.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await b(150);
  const satir=d.querySelectorAll('#secilenler .sdosya');
  T('dosyalar listelendi', satir.length===2);
  const sec=d.querySelector('#secilenler select');
  T('teknige atandi (UWFP)', sec && sec.value==='UWFP');
  console.log('     ', [...d.querySelectorAll('#secilenler .sdosya .ad')].map(x=>x.textContent).join(', '));

  console.log('--- ikinci teknik + dosya dagitimi ---');
  const cip2=[...d.querySelectorAll('#ntek .cip')].find(x=>x.textContent==='OCT');
  cip2.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await b(150);
  const secler=d.querySelectorAll('#secilenler select');
  T('her dosyada teknik secici var', secler.length===2);
  T('secicide 2 secenek var', secler[0].options.length===2);
  secler[1].value='OCT'; secler[1].dispatchEvent(new w.Event('change',{bubbles:true}));
  await b(80);
  T('ikinci dosya OCT oldu', d.querySelectorAll('#secilenler select')[1].value==='OCT');

  console.log('--- eksik uyarisi ---');
  const eksik=d.getElementById('eksik');
  console.log('     ', eksik.hidden?'(gizli)':eksik.textContent);
  console.log('\n'+g+' gecti, '+k+' kaldi');
  process.exit(k?1:0);
})().catch(e=>{console.log('COKTU:',e&&e.stack);process.exit(1);});
