import { ExternalLink, Gamepad2, Cpu } from "lucide-react";
import { Link } from "react-router-dom";
import type { Server } from "../../types";
import { Badge } from "../ui/Badge";

export function ServerCard({ server }: { server: Server }) {
  const running = server.provision_status === "running";
  return (
    <article className="server-card">
      <div className="server-card__top">
        <span className="block-icon"><Gamepad2 /></span>
        <Badge tone={running ? "success" : server.provision_status === "failed" ? "danger" : "warning"}>
          {server.provision_status || "unknown"}
        </Badge>
      </div>
      <h3>{server.name}</h3>
      <p className="mono">{server.hf_space_id}</p>
      <div className="server-card__meta">
        <span>{server.minecraft_version ?? "1.21.1"}</span>
        <span><Cpu size={13} /> Agent {server.template_version ?? "legacy"}</span>
        <span>{server.hardware ?? "ZeroGPU"}</span>
      </div>
      <div className="server-card__badges"><Badge tone="success">JAVA</Badge><Badge tone="info">BEDROCK</Badge></div>
      <div className="server-card__actions">
        <Link className="button button--primary" to={`/servers/${server.id}/dashboard`}>إدارة السيرفر</Link>
        <a className="icon-link" href={`https://huggingface.co/spaces/${server.hf_space_id}`} target="_blank" rel="noreferrer" aria-label="Open Hugging Face"><ExternalLink size={16} /></a>
      </div>
    </article>
  );
}
