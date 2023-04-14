export interface Settings {
  root_level: boolean;
  directory_name: string;
  server: {
    chart_version: string;
    application_version: string;
    repository: string;
    tag: string;
    host: string;
  };
  admin_ui?: {
    chart_version: string;
    application_version: string;
    repository: string;
    tag: string;
    host: string;
  };
} //TODO: create a json schema for this settings interface
