import { invokeAgent } from "./servers.service";

export interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
}

export async function searchModrinthPlugins(query: string): Promise<ModrinthProject[]> {
  const url = new URL("https://api.modrinth.com/v2/search");
  url.searchParams.set("query", query.trim());
  url.searchParams.set("limit", "12");
  url.searchParams.set("index", "relevance");
  url.searchParams.set("facets", JSON.stringify([["project_type:plugin"], ["categories:paper", "categories:purpur", "categories:spigot", "categories:bukkit"]]));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("تعذر البحث في Modrinth حاليًا");
  const data = await response.json() as { hits?: ModrinthProject[] };
  return data.hits ?? [];
}

export const installModrinthPlugin = (serverId: string, projectId: string) =>
  invokeAgent<{ ok: boolean; name: string; size: number; sha512: string }>(
    serverId,
    "plugin_install",
    { project_id: projectId },
  );
