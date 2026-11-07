const clamp=x=>Math.max(0,Math.min(1,x));
const p=(t,a,b)=>clamp((t-a)/(b-a));
const eo=x=>1-Math.pow(1-x,4);
const eio=x=>x<.5?8*x*x*x*x:1-Math.pow(-2*x+2,4)/2;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
function icon(name,size,color){return `<span class="ico" style="width:${size}px;height:${size}px;color:${color||'currentColor'}">${ICONS[name]}</span>`}
// enter at a (duration d), exit at b (duration e). dy = rise distance
function vis(el,t,a,b=1e9,{d=.6,e=.45,dy=60,sc=0}={}){
  const i=eo(p(t,a,a+d)), o=1-eio(p(t,b,b+e)), k=i*o;
  el.style.opacity=k;
  const y=(1-i)*dy - (1-o)*dy*.6, s=1-(1-i)*sc;
  el.style.transform=`translateY(${y}px) scale(${s})`;
  el.style.visibility=k<=0.001?'hidden':'visible';
  return k;
}
function sceneVis(el,t,a,b){const k=(t>=a-0.01&&t<b+0.6);el.style.display=k?'flex':'none';}
const MARK=`<svg viewBox="0 0 40 40" fill="none"><defs><linearGradient id="tl" x1="4" y1="-2.8" x2="36" y2="42.8" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#CB8D97"/><stop offset=".55" stop-color="#A05B66"/><stop offset="1" stop-color="#6C3D44"/></linearGradient><linearGradient id="sh" x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="40" height="40" rx="12" fill="url(#tl)"/><rect width="40" height="40" rx="12" fill="url(#sh)"/><g transform="translate(9 9) scale(.9167)"><path d="M8 4.2c-2.3 0-3.9 1.8-3.9 4.4 0 2.3.9 3.8 1.5 5.7.5 1.6.7 3.1 1.1 4.6.3 1.2.9 2 1.7 2 1 0 1.3-1.1 1.6-2.6.3-1.6.6-3 2-3s1.7 1.4 2 3c.3 1.5.6 2.6 1.6 2.6.8 0 1.4-.8 1.7-2 .4-1.5.6-3 1.1-4.6.6-1.9 1.5-3.4 1.5-5.7 0-2.6-1.6-4.4-3.9-4.4-1.6 0-2.4.9-4 .9s-2.4-.9-4-.9Z" fill="#fff"/><path d="M9 9.6c.9.9 1.9 1.3 3 1.3s2.1-.4 3-1.3" stroke="#A05B66" stroke-width="1.3" stroke-linecap="round"/><path d="M19.3 1.8l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4Z" fill="#EBDAB6"/></g></svg>`;
function ctaHTML(foot){return `
<div class="scene" id="cta" style="align-items:center;text-align:center;background:var(--bg)">
  <div class="abs" id="ctaBlob" style="width:1100px;height:1100px;border-radius:50%;background:radial-gradient(circle,rgba(235,218,182,.55),rgba(235,218,182,0) 65%);top:180px;left:-10px"></div>
  <div id="ctaLogo" style="display:flex;align-items:center;gap:28px;position:relative">
    <span style="width:150px;height:150px;display:block;filter:drop-shadow(0 14px 24px rgba(133,74,83,.3))">${MARK}</span>
    <div style="text-align:left"><div style="display:flex;align-items:baseline;gap:16px"><span style="font:600 92px/1 var(--display);letter-spacing:-.025em">Clin<span style="color:var(--r600)">IQ</span></span><span style="font:700 30px/1 var(--sans);letter-spacing:.18em;color:var(--g600)">PRO</span></div><div style="font:500 32px/1 var(--sans);color:var(--n500);margin-top:14px">Odontologia &amp; Estética</div></div>
  </div>
  <p class="h2" id="ctaH" style="margin-top:90px;position:relative;font-size:76px">Teste grátis por 3&nbsp;dias</p>
  <p class="lead" id="ctaL" style="margin-top:28px;position:relative">Depois, R$ 49,90/mês. Sem cartão de crédito, sem fidelidade.</p>
  <div id="ctaB" style="margin-top:70px;position:relative"><span class="btn">Comece pelo link da bio ${ICONS['arrow-right']}</span></div>
  ${foot?`<p id="ctaF" style="position:absolute;bottom:330px;left:90px;right:90px;font:400 26px/1.4 var(--sans);color:var(--n500);margin:0">${foot}</p>`:''}
</div>`}
function ctaRender(t,a){
  sceneVis($('#cta'),t,a,99);
  vis($('#ctaLogo'),t,a+.1,1e9,{sc:.08,dy:30});
  vis($('#ctaH'),t,a+.5); vis($('#ctaL'),t,a+.8);
  vis($('#ctaB'),t,a+1.1,1e9,{sc:.1});
  const pulse=1+0.025*Math.sin(Math.max(0,t-a-1.8)*4)*(t>a+1.8?1:0);
  $('#ctaB .btn').style.transform=`scale(${pulse})`;
  if($('#ctaF')) vis($('#ctaF'),t,a+1.4,1e9,{dy:0});
  $('#ctaBlob').style.transform=`scale(${0.9+0.1*eo(p(t,a,a+3))})`;
  $('#cta').style.opacity = eo(p(t,a,a+.35));
}
