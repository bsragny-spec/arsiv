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

  console.log('--- teknik SECILMEDEN ---');
  const uyari=d.querySelector('#dosyabolum .serit.uyari');
  T('uyari gosterildi', !!uyari);
  if(uyari) console.log('     ', uyari.textContent.replace(/\s+/g,' ').slice(0,110));

  console.log('--- UWFP sec ---');
  const cip=[...d.querySelectorAll('#ntek .cip')].find(x=>x.textContent==='UWFP');
  cip.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await b(150);
  const kutular=d.querySelectorAll('.tkutu');
  T('UWFP icin birakma kutusu olustu', kutular.length===1);
  T('kutunun basligi UWFP', d.querySelector('.tkutu-bas .ad').textContent==='UWFP');
  T('kutu bos yaziyor', /boş/.test(d.querySelector('.tkutu-bas .adet').textContent));

  console.log('--- OCT de sec ---');
  [...d.querySelectorAll('#ntek .cip')].find(x=>x.textContent==='OCT')
    .dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await b(150);
  T('iki kutu var', d.querySelectorAll('.tkutu').length===2);
  console.log('     kutular:', [...d.querySelectorAll('.tkutu-bas .ad')].map(x=>x.textContent).join(', '));

  console.log('--- OCT kutusuna dosya surukle ---');
  const octKutu=[...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT');
  const dosyalar=['o1.e2e','o2.e2e'].map(a=>new w.File([new Uint8Array(2048)],a,{type:'application/octet-stream'}));
  const ev=new w.Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(ev,'dataTransfer',{value:{files:dosyalar}});
  octKutu.dispatchEvent(ev);
  await b(150);
  const oct2=[...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT');
  const uwf2=[...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='UWFP');
  T('dosyalar OCT kutusuna dustu', oct2.querySelectorAll('.sdosya').length===2);
  T('UWFP kutusu bos kaldi', uwf2.querySelectorAll('.sdosya').length===0);
  console.log('     OCT:', oct2.querySelector('.adet').textContent);

  console.log('--- UWFP kutusuna tiklayip dosya sec ---');
  uwf2.querySelector('[data-tbirak]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const gi=d.getElementById('ndosya');
  Object.defineProperty(gi,'files',{value:[new w.File([new Uint8Array(500)],'u1.jpg',{type:'image/jpeg'})],configurable:true});
  gi.dispatchEvent(new w.Event('change',{bubbles:true}));
  await b(150);
  const uwf3=[...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='UWFP');
  T('UWFP kutusuna dustu', uwf3.querySelectorAll('.sdosya').length===1);
  T('OCT bozulmadi', [...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT').querySelectorAll('.sdosya').length===2);

  console.log('--- dosyayi baska klasore tasi ---');
  const sec=uwf3.querySelector('select');
  T('tasima secicisi var', !!sec);
  sec.value='OCT'; sec.dispatchEvent(new w.Event('change',{bubbles:true}));
  await b(150);
  T('UWFP bosaldi', [...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='UWFP').querySelectorAll('.sdosya').length===0);
  T('OCT 3 dosya oldu', [...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT').querySelectorAll('.sdosya').length===3);

  console.log('--- dosya cikar ---');
  [...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT').querySelector('[data-cikar]')
    .dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await b(150);
  T('2 dosya kaldi', [...d.querySelectorAll('.tkutu')].find(k=>k.dataset.tkutu==='OCT').querySelectorAll('.sdosya').length===2);

  console.log('\n'+g+' gecti, '+k+' kaldi');
  process.exit(k?1:0);
})().catch(e=>{console.log('COKTU:',e&&e.stack);process.exit(1);});
