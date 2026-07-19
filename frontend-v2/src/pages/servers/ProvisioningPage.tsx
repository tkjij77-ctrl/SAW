import { useQuery } from "@tanstack/react-query";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { PageError } from "../../components/ui/PageState";
import { getProvisioningStatus } from "../../services/provisioning.service";

const steps = ["validating", "creating_dataset", "creating_space", "setting_hardware", "setting_variables", "building", "running"];
const labels: Record<string,string> = { validating:"التحقق من الصلاحيات", creating_dataset:"إنشاء Private Dataset", creating_space:"إنشاء Private Space", setting_hardware:"اختيار ZeroGPU", setting_variables:"ضبط Variables ورفع Agent", building:"بناء وتشغيل Space", running:"السيرفر جاهز" };

export function ProvisioningPage() {
  const { jobId = "" } = useParams();
  const query = useQuery({ queryKey:["provision",jobId], queryFn:()=>getProvisioningStatus(jobId), refetchInterval:q => ["running","failed","cancelled"].includes(q.state.data?.state ?? "") ? false : 5000 });
  if (query.error) return <PageError message={(query.error as Error).message} retry={() => void query.refetch()} />;
  const job=query.data; const current=Math.max(0,steps.indexOf(job?.step ?? "validating")); const failed=job?.state==="failed";
  return <div className="provision-page"><header><span className="eyebrow">SERVER PROVISIONING</span><h1>{failed?"فشل إنشاء السيرفر":job?.state==="running"?"تم إنشاء السيرفر":"جارٍ إنشاء السيرفر..."}</h1><p className="mono">{job?.space_repo_id}</p></header><div className="progress"><i style={{width:`${job?.progress ?? 3}%`}} /></div><strong className="progress-value">{job?.progress ?? 3}%</strong><div className="timeline">{steps.map((step,index)=>{const done=index<current||job?.state==="running";const active=index===current&&!failed;return <div key={step} className={`timeline__item ${done?"done":""} ${active?"active":""} ${failed&&index===current?"failed":""}`}><span>{done?<Check/>:failed&&index===current?<X/>:active?<LoaderCircle className="spin"/>:<Circle/>}</span><div><b>{labels[step]}</b><small>{done?"Completed":active?"In progress":"Pending"}</small></div></div>})}</div>{job?.error_message&&<div className="error-box"><b>PROVISIONING ERROR</b><p>{job.error_message}</p></div>}<div className="form-actions">{job?.state==="running"&&job.server_id&&<Link to={`/servers/${job.server_id}/dashboard`}><Button variant="primary">فتح لوحة التحكم</Button></Link>}<Link to="/servers"><Button>العودة للسيرفرات</Button></Link></div></div>;
}
