import { useQuery } from "@tanstack/react-query";
import { Box, Download, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { deleteRemoteItem, listFiles, renameRemoteItem } from "../../services/files.service";
import { installModrinthPlugin, searchModrinthPlugins, type ModrinthProject } from "../../services/modrinth.service";

export function PluginsPage({ mods = false }: { mods?: boolean }) {
  const { serverId = "" } = useParams();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const directory = mods ? "mods" : "plugins";
  const query = useQuery({ queryKey: [directory, serverId], queryFn: () => listFiles(serverId, directory), retry: 1 });
  const jars = (query.data?.files ?? []).filter((file) => file.name.endsWith(".jar") || file.name.endsWith(".jar.disabled"));

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (mods) return;
    setSearching(true);
    setMessage("");
    try { setResults(await searchModrinthPlugins(search)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Search failed"); }
    finally { setSearching(false); }
  };

  const install = async (project: ModrinthProject) => {
    setBusy(project.project_id);
    setMessage(`جارٍ اختيار الإصدار المتوافق والتحقق من ${project.title}...`);
    try {
      const installed = await installModrinthPlugin(serverId, project.project_id);
      setMessage(`تم تثبيت ${installed.name} والتحقق من SHA-512. أعد تشغيل السيرفر لتفعيله.`);
      await query.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Install failed"); }
    finally { setBusy(null); }
  };

  const toggle = async (name: string) => {
    const disabled = name.endsWith(".disabled");
    const next = disabled ? name.replace(/\.disabled$/, "") : `${name}.disabled`;
    setBusy(name);
    try { await renameRemoteItem(serverId, `${directory}/${name}`, next); setMessage(disabled ? "تم تفعيل الملف؛ أعد تشغيل السيرفر." : "تم تعطيل الملف؛ أعد تشغيل السيرفر."); await query.refetch(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Update failed"); }
    finally { setBusy(null); }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`حذف ${name} نهائيًا؟`)) return;
    setBusy(name);
    try { await deleteRemoteItem(serverId, `${directory}/${name}`); setMessage("تم حذف الملف؛ أعد تشغيل السيرفر."); await query.refetch(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Delete failed"); }
    finally { setBusy(null); }
  };

  if (mods) return (
    <div className="page"><header className="page-header"><div><span className="eyebrow">MOD LOADER SAFETY</span><h1>المودات</h1><p>Current server software is Purpur/Paper</p></div></header><Card className="coming-soon"><Box /><h2>تثبيت المودات غير متاح على Purpur</h2><p>لن نثبت Fabric أو Forge mods على Paper بصورة غير آمنة. سيتم تفعيله عند إضافة اختيار Server Loader مستقل.</p></Card><InstalledFiles files={jars} busy={busy} toggle={toggle} remove={remove} /></div>
  );

  return (
    <div className="page">
      <header className="page-header"><div><span className="eyebrow">VERIFIED MODRINTH INSTALLER</span><h1>الإضافات</h1><p>Compatible Paper, Purpur, Spigot and Bukkit plugins</p></div><Button onClick={() => void query.refetch()}><RefreshCw size={14} /> Refresh</Button></header>
      {message && <div className="form-message">{message}</div>}
      <form className="toolbar" onSubmit={submitSearch}><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Modrinth plugins..." /></label><Button variant="primary" disabled={searching}>{searching ? "Searching..." : "Search"}</Button></form>

      {!!results.length && <div className="plugin-list">{results.map((project) => <Card className="plugin-row" key={project.project_id}><span className="service-logo"><Box /></span><div><strong>{project.title}</strong><small>{project.description} · {project.downloads.toLocaleString()} downloads</small></div><Badge tone="info">Modrinth</Badge><Button variant="primary" disabled={busy !== null} onClick={() => void install(project)}><Download size={15} />{busy === project.project_id ? "Installing..." : "Install"}</Button></Card>)}</div>}
      <h2>Installed plugins</h2>
      <InstalledFiles files={jars} busy={busy} toggle={toggle} remove={remove} />
      {!jars.length && !query.isLoading && <Card className="coming-soon"><Box /><h2>لا توجد إضافات مثبتة</h2><p>ابحث في Modrinth وثبّت إصدارًا متوافقًا تلقائيًا.</p></Card>}
    </div>
  );
}

function InstalledFiles({ files, busy, toggle, remove }: { files: Array<{ name: string; size: number }>; busy: string | null; toggle: (name: string) => Promise<void>; remove: (name: string) => Promise<void> }) {
  return <div className="plugin-list">{files.map((file) => { const disabled = file.name.endsWith(".disabled"); return <Card className="plugin-row" key={file.name}><span className="service-logo"><Box /></span><div><strong>{file.name.replace(/\.jar(?:\.disabled)?$/, "")}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.name}</small></div><Badge tone={disabled ? "warning" : "success"}>{disabled ? "Disabled" : "Enabled"}</Badge><Button disabled={busy !== null} onClick={() => void toggle(file.name)}><Power size={14} />{disabled ? "Enable" : "Disable"}</Button><Button variant="danger" disabled={busy !== null} onClick={() => void remove(file.name)}><Trash2 size={14} /></Button></Card>; })}</div>;
}
