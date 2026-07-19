import { Github, Link2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { getLinkedHuggingFaceUsername, startHuggingFaceLink, unlinkHuggingFace } from "../../services/huggingface.service";

export function ConnectionsPage(){
  const [username,setUsername]=useState(()=>getLinkedHuggingFaceUsername());
  const [error,setError]=useState(()=>sessionStorage.getItem("hf_link_error")??"");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    sessionStorage.removeItem("hf_link_error");
    const refresh=()=>setUsername(getLinkedHuggingFaceUsername());
    window.addEventListener("hf-connection-changed",refresh);
    return()=>window.removeEventListener("hf-connection-changed",refresh);
  },[]);

  const connect=async()=>{setBusy(true);setError("");try{await startHuggingFaceLink()}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false)}};
  const disconnect=async()=>{if(!confirm("فصل Hugging Face؟ سيتوقف إنشاء وإدارة Spaces حتى تعيد الربط."))return;setBusy(true);try{await unlinkHuggingFace();setUsername(null)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};

  return <div className="page narrow-page"><header className="page-header"><div><span className="eyebrow">CONNECTED ACCOUNTS</span><h1>الحسابات المرتبطة</h1><p>Hugging Face repository access and social identities</p></div></header>{error&&<div className="form-error connection-error">{error}</div>}<div className="settings-stack"><Card className="connection-setting"><span className="service-logo hf">HF</span><div><h3>Hugging Face</h3><p>{username?<>مرتبط بالحساب <b>{username}</b> بصلاحية إدارة Spaces وDatasets.</>:"مطلوب لإنشاء Private ZeroGPU Spaces وDatasets."}</p></div>{username?<Button variant="danger" disabled={busy} onClick={()=>void disconnect()}><Unlink size={15}/> Disconnect</Button>:<Button variant="primary" disabled={busy} onClick={()=>void connect()}><Link2 size={15}/> {busy?"Redirecting...":"Connect"}</Button>}</Card><Card className="connection-setting"><span className="service-logo"><Github/></span><div><h3>GitHub</h3><p>طريقة تسجيل الدخول الرئيسية لحساب SAW.</p></div><span className="badge badge--success">Enabled</span></Card></div></div>;
}
