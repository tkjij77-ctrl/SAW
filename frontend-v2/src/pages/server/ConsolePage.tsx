import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Search, Send, WrapText } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { invokeAgent } from "../../services/servers.service";

export function ConsolePage() {
  const { serverId = "" } = useParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [command, setCommand] = useState("");
  const [wrap, setWrap] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const terminal = useRef<HTMLDivElement>(null);
  const logs = useQuery({ queryKey: ["logs", serverId], queryFn: () => invokeAgent<string>(serverId, "logs"), refetchInterval: 2500, retry: 1 });
  const status = useQuery({ queryKey: ["console-status", serverId], queryFn: () => invokeAgent<{ running?: boolean; status?: string }>(serverId, "status"), refetchInterval: 5000, retry: 1 });
  const lines = useMemo(() => String(logs.data ?? "").split("\n").filter((line) => {
    const lower = line.toLowerCase();
    const searched = !search || lower.includes(search.toLowerCase());
    const filtered = filter === "all" || (filter === "info" ? !lower.includes("warn") && !lower.includes("error") : lower.includes(filter));
    return searched && filtered;
  }), [logs.data, search, filter]);

  useEffect(() => {
    const element = terminal.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 180) element.scrollTop = element.scrollHeight;
  }, [logs.data]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const value = command.trim().replace(/^\//, "");
    if (!value || sending) return;
    setSending(true);
    setMessage("");
    try {
      await invokeAgent(serverId, "command", { command: value });
      setCommand("");
      await logs.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إرسال الأمر");
    } finally {
      setSending(false);
    }
  };

  const download = () => {
    const blob = new Blob([String(logs.data ?? "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `saw-console-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page console-page">
      <header className="page-header"><div><span className="eyebrow">LIVE TERMINAL</span><h1>Console</h1><p>Monitor logs and execute server commands</p></div><BadgeLive online={Boolean(status.data?.running)} phase={status.data?.status} /></header>
      {message && <div className="form-error">{message}</div>}
      <div className="console-panel">
        <div className="console-tools">
          <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs..." /></label>
          {["all", "info", "warn", "error"].map((value) => <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value.toUpperCase()}</button>)}
          <span className="toolbar__spacer" />
          <button type="button" className={wrap ? "active" : ""} title="Wrap lines" onClick={() => setWrap((value) => !value)}><WrapText size={15} /></button>
          <button type="button" title="Copy logs" onClick={() => void navigator.clipboard.writeText(String(logs.data ?? ""))}><Copy size={15} /></button>
          <button type="button" title="Download logs" onClick={download}><Download size={15} /></button>
        </div>
        <div ref={terminal} className="terminal" style={{ whiteSpace: wrap ? "pre-wrap" : "pre", overflowWrap: wrap ? "anywhere" : "normal" }}>
          {logs.isError && <div className="error">[SAW] تعذر الاتصال بالـ Agent.</div>}
          {lines.map((line, index) => <div className={line.includes("ERROR") ? "error" : line.includes("WARN") ? "warn" : line.includes("joined") ? "join" : ""} key={`${index}-${line.slice(0, 20)}`}>{line}</div>)}
        </div>
        <form className="command-bar" onSubmit={send}><span>&gt;</span><input value={command} maxLength={512} onChange={(event) => setCommand(event.target.value)} placeholder="Enter server command..." /><Button variant="primary" type="submit" disabled={sending || !status.data?.running}><Send size={15} />{sending ? "Sending..." : "Send"}</Button></form>
      </div>
    </div>
  );
}

function BadgeLive({ online, phase }: { online: boolean; phase?: string }) {
  return <span className={`live-pill ${online ? "online" : "offline"}`}><i />{online ? "LIVE" : (phase?.toUpperCase() ?? "OFFLINE")}</span>;
}
