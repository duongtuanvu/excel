import type { Config, Report } from './model';
import type { Workspace } from './source-model';
import type { SavedSource } from './workspace-model';
type SourceVersion={sourceId:string;revision:number};
export type Requests={
  demo:{input:null;output:Workspace};
  import:{input:{name:string;bytes:ArrayBuffer};output:Workspace};
  sheet:{input:{sheet:string};output:Workspace};
  activateSource:{input:{sourceId:string};output:Workspace};
  renameSource:{input:{sourceId:string;alias:string};output:Workspace};
  removeSource:{input:{sourceId:string};output:Workspace};
  replaceSource:{input:SourceVersion&{name:string;bytes:ArrayBuffer};output:Workspace};
  restoreSource:{input:{slot:SavedSource;name:string;bytes:ArrayBuffer};output:Workspace};
  report:{input:SourceVersion&{config:Config;page:number};output:Report};
  export:{input:SourceVersion&{config:Config;format:'xlsx'|'csv'};output:{bytes:ArrayBuffer;name:string;mime:string}};
};
export type Request={ [K in keyof Requests]:{id:number;type:K;input:Requests[K]['input']} }[keyof Requests];
export type Response={id:number;ok:true;data:unknown}|{id:number;ok:false;error:string};
