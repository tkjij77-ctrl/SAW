import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, File, FileArchive, FilePlus2, Folder, FolderPlus, FolderUp, Pencil, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { createRemoteItem, deleteRemoteItem, downloadRemoteFile, listFiles, readFile, renameRemoteItem, uploadFile, waitForSafeApply, writeFileSafe } from "../../services/files.service";

export function FilesPage() {
  const { serverId = "" } = useParams();
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [binary, setBinary] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const listing = useQuery({ queryKey: ["files", serverId, path], queryFn: () => listFiles(serverId, path), retry: 1 });
  const join = (name: string) => [path, name].filter(Boolean).join("/");

  const open = async (name: string, isBinary: boolean) => {
    const remote = join(name);
    setSelected(remote);
    setBinary(isBinary);
    if (isBinary) { setContent(""); setStatus("Binary file — use Download"); return; }
    setBusy(true);
    try {
      const data = await readFile(serverId, remote);
      setContent(data.content);
      setStatus(`${data.size} bytes · text file`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open file");
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!selected || binary || busy) return;
    setBusy(true);
    setStatus("Backend Safe Apply · stop → write → verify → persist → restart...");
    try {
      const queued = await writeFileSafe(serverId, selected, content);
      const result = await waitForSafeApply(serverId, queued.job_id, (state) => {
        setStatus(state === "running" ? "Backend Safe Apply running · stop → write → verify → Dataset → restart..." : `Safe Apply ${state}...`);
      });
      if (result.content !== content) setContent(result.content);
      const persistenceNote = result.persistence === "dataset-verified"
        ? ` · Dataset snapshot: ${result.dataset_backup ?? "verified"}`
        : " · local-only (Dataset not configured)";
      setStatus(`Saved SHA-256 ${result.sha256.slice(0, 12)}…${persistenceNote}${result.restarting ? " · server restarting" : ""}`);
      await listing.refetch();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Backend Safe Apply failed");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selected && !binary && !busy) void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [selected, binary, busy, content]);

  const up = () => { const parts = path.split("/").filter(Boolean); parts.pop(); setPath(parts.join("/")); clearSelection(); };
  const clearSelection = () => { setSelected(""); setContent(""); setBinary(false); };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setStatus(`Uploading ${files.length} file(s)...`);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(serverId, path, file, (_percent, detail) => setStatus(detail));
      }
      setStatus("Upload completed and verified");
      await listing.refetch();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Upload failed"); }
    finally { setBusy(false); if (picker.current) picker.current.value = ""; }
  };

  const create = async (type: "file" | "folder") => {
    const name = window.prompt(type === "folder" ? "Folder name" : "File name");
    if (!name) return;
    setBusy(true);
    try { await createRemoteItem(serverId, join(name), type); setStatus(`${type} created`); await listing.refetch(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Create failed"); }
    finally { setBusy(false); }
  };

  const rename = async () => {
    if (!selected) return;
    const current = selected.split("/").pop() ?? selected;
    const name = window.prompt("New name", current);
    if (!name || name === current) return;
    setBusy(true);
    try { await renameRemoteItem(serverId, selected, name); setStatus("Renamed successfully"); clearSelection(); await listing.refetch(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Rename failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete ${selected}?`)) return;
    setBusy(true);
    try { await deleteRemoteItem(serverId, selected); clearSelection(); setStatus("Deleted successfully"); await listing.refetch(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Delete failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="page files-page">
      <header className="page-header"><div><span className="eyebrow">FILE MANAGER</span><h1>الملفات</h1><p className="mono">/root/{path}</p></div><div className="power-actions"><input ref={picker} hidden type="file" multiple onChange={(event) => void upload(event.target.files)} /><Button disabled={busy} onClick={() => picker.current?.click()}><Upload size={15} />{busy ? "Working..." : "Upload"}</Button><Button disabled={busy} onClick={() => void create("file")}><FilePlus2 size={15} /> New File</Button><Button disabled={busy} onClick={() => void create("folder")}><FolderPlus size={15} /> New Folder</Button><Button disabled={listing.isFetching} onClick={() => void listing.refetch()}><RefreshCw size={15} /></Button></div></header>
      <div className="file-layout">
        <aside className="file-browser card">
          <button className="file-row" onClick={up}><FolderUp size={16} /><span>..</span></button>
          {listing.isError && <div className="form-error">تعذر تحميل المسار.</div>}
          {listing.data?.folders.map((item) => <button className="file-row folder" key={item.name} onClick={() => { setPath(join(item.name)); clearSelection(); }}><Folder size={16} /><span>{item.name}</span><ChevronRight size={14} /></button>)}
          {listing.data?.files.map((item) => <button className={`file-row ${selected === join(item.name) ? "active" : ""}`} key={item.name} onClick={() => void open(item.name, item.binary)}>{item.binary ? <FileArchive size={16} /> : <File size={16} />}<span>{item.name}</span><small>{format(item.size)}</small></button>)}
        </aside>
        <section className="file-editor card">
          <div className="file-editor__head">
            <div className="file-editor__title"><span className="eyebrow">EDITOR</span><strong title={selected}>{selected || "اختر ملفًا للتعديل"}</strong></div>
            <div className="file-editor-actions">
              <Button variant="primary" disabled={!selected || binary || busy} title="Safe apply: stop, save, verify and restart (Ctrl+S)" onClick={() => void save()}><Save size={16} /> حفظ وتطبيق</Button>
              <Button disabled={!selected || busy} title="Rename file" onClick={() => void rename()}><Pencil size={15} /> إعادة تسمية</Button>
              <Button disabled={!selected || busy} title="Download file" onClick={() => selected && void downloadRemoteFile(serverId, selected)}><Download size={15} /> تنزيل</Button>
              <Button variant="danger" disabled={!selected || busy} title="Delete file" onClick={() => void remove()}><Trash2 size={15} /> حذف</Button>
            </div>
          </div>
          <textarea disabled={!selected || binary || busy} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Select a text file..." />
          <div className="editor-status">{status}</div>
        </section>
      </div>
    </div>
  );
}

function format(value: number) { if (value < 1024) return `${value} B`; if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1048576).toFixed(1)} MB`; }
