export type ServerRole = "owner" | "admin" | "operator" | "editor" | "viewer";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  username_completed?: boolean;
  terms_version?: string | null;
  terms_accepted_at?: string | null;
}

export interface Server {
  id: string;
  owner_id: string;
  name: string;
  hf_space_id: string;
  dataset_repo_id: string | null;
  minecraft_version: string | null;
  hardware: string | null;
  template_version: string | null;
  provision_status: string;
  provision_step: string | null;
  role?: ServerRole;
  is_agent?: boolean;
  source?: "owned" | "shared";
}

export interface ProvisioningJob {
  id: string;
  server_id: string | null;
  space_repo_id: string;
  dataset_repo_id: string;
  state: string;
  step: string;
  progress: number;
  error_message: string | null;
  hardware_warning: string | null;
}
