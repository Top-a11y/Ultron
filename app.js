import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,GoogleAuthProvider,signInWithPopup,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,doc,setDoc,deleteDoc,getDocs,query,orderBy} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {firebaseConfig} from "./config.js";

const $=id=>document.getElementById(id);
const fb=initializeApp(firebaseConfig),auth=getAuth(fb),db=getFirestore(fb);
let uid=null,chats=[],cur=null,pending=[],busy=false;
const LS=k=>localStorage.getItem(k)||"";

/* ---------- auth ---------- */
const authErr=e=>$("autherr").textContent=String(e.code||e.message).replace("auth/","").replace(/-/g," ");
$("login").onclick=()=>signInWithEmailAndPassword(auth,$("email").value,$("pass").value).catch(authErr);
$("signup").onclick=()=>createUserWithEmailAndPassword(auth,$("email").value,$("pass").value).catch(authErr);
$("google").onclick=()=>signInWithPopup(auth,new GoogleAuthProvider()).catch(authErr);
$("logout").onclick=()=>signOut(auth);
onAuthStateChanged(auth,async u=>{
  $("auth").hidden=!!u;$("app").hidden=!u;
  if(!u){uid=null;return}
  uid=u.uid;$("model").value=LS("model")||"gemini-2.5-flash";
  const s=await getDocs(query(collection(db,"users",uid,"chats"),orderBy("updated","desc")));
  chats=s.docs.map(d=>d.data());newChat();
  if(!LS("gkey"))$("dlg").showModal();
});

/* ---------- chats ---------- */
function newChat(){cur={id:crypto.randomUUID(),title:"New chat",updated:Date.now(),messages:[]};render();$("side").classList.remove("open")}
const save=()=>{cur.updated=Date.now();if(!chats.includes(cur))chats.unshift(cur);
  const slim={...cur,messages:cur.messages.map(m=>({role:m.role,text:m.text,imgs:m.imgs?m.imgs.length:0}))};
  setDoc(doc(db,"users",uid,"chats",cur.id),slim).catch(console.error)};
function render(){
  $("title").textContent=cur.title;
  $("chatlist").innerHTML="";
  chats.sort((a,b)=>b.updated-a.updated).forEach(c=>{
    const d=document.createElement("div");d.className="chat"+(c===cur?" on":"");
    d.innerHTML=`<span></span><b title="Delete">✕</b>`;d.firstChild.textContent=c.title;
    d.onclick=()=>{cur=c;render();$("side").classList.remove("open")};
    d.querySelector("b").onclick=e=>{e.stopPropagation();if(!confirm("Delete this chat?"))return;
      deleteDoc(doc(db,"users",uid,"chats",c.id));chats=chats.filter(x=>x!==c);if(c===cur)newChat();else render()};
    $("chatlist").append(d)});
  const box=$("msgs");box.innerHTML="";
  if(!cur.messages.length)box.innerHTML=`<div class="empty"><h2>What do you need?</h2>Ask anything, or add images with ＋.</div>`;
  cur.messages.forEach(m=>box.append(bubble(m)));
  box.scrollTop=box.scrollHeight;
}
function md(t){
  const esc=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
  return esc(t).replace(/```(\w*)\n?([\s\S]*?)```/g,(_,l,c)=>`<pre><code>${c}</code></pre>`)
    .replace(/`([^`\n]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>")
    .replace(/\n/g,"<br>").replace(/(<pre[\s\S]*?<\/pre>)/g,x=>x.replace(/<br>/g,"\n"));
}
function bubble(m){
  const d=document.createElement("div");d.className="msg "+m.role+(m.err?" err":"");
  if(m.imgs&&m.imgs.length&&m.imgs[0].data)m.imgs.forEach(i=>{const im=new Image();im.src=`data:${i.mime};base64,${i.data}`;d.append(im)});
  else if(m.imgs)d.append(`🖼 ${m.imgs} image(s) `);
  const t=document.createElement("div");t.innerHTML=md(m.text);d.append(t);return d;
}

/* ---------- images ---------- */
function shrink(file){return new Promise(res=>{
  const im=new Image();im.onload=()=>{const s=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement("canvas");
    c.width=im.width*s;c.height=im.height*s;c.getContext("2d").drawImage(im,0,0,c.width,c.height);
    res({mime:"image/jpeg",data:c.toDataURL("image/jpeg",.85).split(",")[1]})};im.src=URL.createObjectURL(file)})}
async function addFiles(fs){for(const f of fs)if(f.type.startsWith("image/"))pending.push(await shrink(f));previews()}
function previews(){const p=$("previews");p.innerHTML="";pending.forEach((i,n)=>{
  const d=document.createElement("div");d.className="pv";d.innerHTML=`<img src="data:${i.mime};base64,${i.data}" alt=""><b>×</b>`;
  d.querySelector("b").onclick=()=>{pending.splice(n,1);previews()};p.append(d)})}
$("file").onchange=e=>{addFiles(e.target.files);e.target.value=""};
$("input").addEventListener("paste",e=>addFiles([...e.clipboardData.files]));

/* ---------- Gemini ---------- */
async function ask(){
  const key=LS("gkey");if(!key){$("dlg").showModal();return}
  const sys=LS("sys")||"You are Ultron, a brilliant, direct and trustworthy assistant. Give accurate, well-reasoned answers in clear plain language. Think carefully before answering and say so when you are unsure.";
  const contents=cur.messages.filter(m=>!m.err).map(m=>({role:m.role,parts:[{text:m.text||" "},...(m.imgs&&m.imgs[0]&&m.imgs[0].data?m.imgs.map(i=>({inline_data:{mime_type:i.mime,data:i.data}})):[])]}));
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${$("model").value}:generateContent`,{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents})});
  const j=await r.json();
  if(!r.ok)throw new Error(j.error?.message||"Request failed");
  return j.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"No answer came back. Try rephrasing.";
}
$("composer").onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const text=$("input").value.trim();if(!text&&!pending.length)return;
  busy=true;$("send").disabled=true;
  cur.messages.push({role:"user",text,imgs:pending});pending=[];previews();$("input").value="";$("input").style.height="";
  if(cur.title==="New chat")cur.title=(text||"Image chat").slice(0,40);
  render();
  const wait={role:"model",text:"Thinking…"};cur.messages.push(wait);render();
  try{wait.text=await ask()}catch(err){wait.text=err.message+" — check your API key in Settings.";wait.err=true}
  render();save();busy=false;$("send").disabled=false;
};
$("input").oninput=e=>{e.target.style.height="auto";e.target.style.height=e.target.scrollHeight+"px"};
$("input").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&!matchMedia("(max-width:760px)").matches){e.preventDefault();$("composer").requestSubmit()}};

/* ---------- ui ---------- */
$("newchat").onclick=newChat;
$("menu").onclick=()=>$("side").classList.toggle("open");
$("model").onchange=e=>localStorage.setItem("model",e.target.value);
$("settings").onclick=()=>{$("key").value=LS("gkey");$("sys").value=LS("sys");$("dlg").showModal()};
$("savecfg").onclick=()=>{localStorage.setItem("gkey",$("key").value.trim());localStorage.setItem("sys",$("sys").value.trim());$("dlg").close()};
$("closecfg").onclick=()=>$("dlg").close();
