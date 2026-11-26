// Bounded arithmetic DSL. User text is never interpolated into SQL.
export const EXPRESSION_LIMITS={length:2048,nodes:48,depth:10,sql:64000} as const;
type Op='+'|'-'|'*'|'/';
type Compare='='|'!='|'<'|'<='|'>'|'>=';
export type Expr={kind:'constant';value:number;literal?:string}|{kind:'ref';name:string}|{kind:'binary';op:Op;left:Expr;right:Expr}|{kind:'neg'|'abs';arg:Expr}|{kind:'coalesce';left:Expr;right:Expr}|{kind:'if';op:Compare;left:Expr;right:Expr;yes:Expr;no:Expr};
export type ExpressionMode='row'|'measure';
const invalid=(detail:string)=>Error('PIVOT_EXPRESSION_INVALID: '+detail);
export function columnRef(name:string):string{return '['+name.replaceAll(']',']]')+']';}
export function parseExpression(input:unknown,mode:ExpressionMode):Expr{
 if(typeof input!=='string'||!input.trim()||input.length>EXPRESSION_LIMITS.length||input.includes('\0'))throw invalid('Công thức trống hoặc vượt giới hạn.');
 const s=input;let p=0,nodes=0;
 const ws=()=>{while(p<s.length&&/\s/.test(s[p]))p++;};
 const take=(t:string)=>{ws();if(!s.startsWith(t,p))return false;p+=t.length;return true;};
 const need=(t:string)=>{if(!take(t))throw invalid('Thiếu '+t+' tại vị trí '+(p+1)+'.');};
 const node=(e:Expr):Expr=>{if(++nodes>EXPRESSION_LIMITS.nodes)throw invalid('Quá nhiều toán hạng.');return e;};
 function atom(depth:number):Expr{
  if(depth>EXPRESSION_LIMITS.depth)throw invalid('Công thức lồng quá sâu.');
  ws();
  if(take('-'))return node({kind:'neg',arg:atom(depth+1)});
  if(take('+'))return atom(depth+1);
  if(take('(')){const v=add(depth+1);need(')');return v;}
  if(s[p]==='['){
   if(mode!=='row')throw invalid('Công thức tổng hợp chỉ dùng @m1, @m2…');
   p++;let name='',closed=false;
   while(p<s.length){const c=s[p++];if(c===']'){if(s[p]===']'){name+=']';p++;}else{closed=true;break;}}else name+=c;}
   if(!closed||!name.trim()||name.length>240||/[\u0000-\u001f\u007f]/.test(name))throw invalid('Tham chiếu cột không hợp lệ.');
   return node({kind:'ref',name});
  }
  if(s[p]==='@'){
   if(mode!=='measure')throw invalid('Công thức từng dòng chỉ dùng [Tên cột].');
   const m=/^@m[1-9][0-9]{0,7}\b/.exec(s.slice(p));
   if(!m)throw invalid('Mã chỉ số không hợp lệ.');
   p+=m[0].length;return node({kind:'ref',name:m[0].slice(1)});
  }
  const numeric=/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(s.slice(p));
  if(numeric){p+=numeric[0].length;const value=Number(numeric[0]);if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw invalid('Hằng số ngoài giới hạn.');return node({kind:'constant',value,literal:numeric[0]});}
  const token=/^[A-Za-z]+/.exec(s.slice(p));
  if(!token)throw invalid('Toán hạng không hợp lệ tại vị trí '+(p+1)+'.');
  p+=token[0].length;const fn=token[0].toUpperCase();
  if(!['IF','ABS','COALESCE'].includes(fn))throw invalid('Chỉ hỗ trợ IF, ABS, COALESCE.');
  need('(');const left=add(depth+1);
  if(fn==='ABS'){need(')');return node({kind:'abs',arg:left});}
  if(fn==='COALESCE'){need(',');const right=add(depth+1);need(')');return node({kind:'coalesce',left,right});}
  ws();const cmp=/^(<=|>=|!=|=|<|>)/.exec(s.slice(p));
  if(!cmp)throw invalid('IF cần phép so sánh =, !=, <, <=, > hoặc >=.');
  p+=cmp[0].length;const right=add(depth+1);need(',');const yes=add(depth+1);need(',');const no=add(depth+1);need(')');
  return node({kind:'if',op:cmp[0] as Compare,left,right,yes,no});
 }
 function mul(depth:number):Expr{
  let left=atom(depth);while(true){ws();const op=s[p];if(op!=='*'&&op!=='/')return left;p++;left=node({kind:'binary',op,left,right:atom(depth)});}
 }
 function add(depth:number):Expr{
  let left=mul(depth);while(true){ws();const op=s[p];if(op!=='+'&&op!=='-')return left;p++;left=node({kind:'binary',op,left,right:mul(depth)});}
 }
 const expr=add(0);ws();if(p!==s.length)throw invalid('Ký tự dư tại vị trí '+(p+1)+'.');
 function check(e:Expr,depth:number):void{
  if(depth>EXPRESSION_LIMITS.depth)throw invalid('Cây công thức quá sâu.');
  if(e.kind==='binary'||e.kind==='coalesce'){check(e.left,depth+1);check(e.right,depth+1);}
  else if(e.kind==='neg'||e.kind==='abs')check(e.arg,depth+1);
  else if(e.kind==='if'){check(e.left,depth+1);check(e.right,depth+1);check(e.yes,depth+1);check(e.no,depth+1);}
 }
 check(expr,0);return expr;
}
export function expressionRefs(e:Expr):string[]{
 if(e.kind==='ref')return [e.name];
 if(e.kind==='constant')return [];
 if(e.kind==='neg'||e.kind==='abs')return expressionRefs(e.arg);
 if(e.kind==='if')return [...expressionRefs(e.left),...expressionRefs(e.right),...expressionRefs(e.yes),...expressionRefs(e.no)];
 if(e.kind==='binary'||e.kind==='coalesce')return [...expressionRefs(e.left),...expressionRefs(e.right)];
 return [];
}
export function printExpression(e:Expr,mode:ExpressionMode,rename:(name:string)=>string=(n=>n)):string{
 const print=(x:Expr)=>printExpression(x,mode,rename);
 switch(e.kind){
 case 'constant':return e.literal??String(e.value);
 case 'ref':return mode==='row'?columnRef(rename(e.name)):'@'+rename(e.name);
 case 'neg':return '-('+print(e.arg)+')';
 case 'abs':return 'ABS('+print(e.arg)+')';
 case 'coalesce':return 'COALESCE('+print(e.left)+', '+print(e.right)+')';
 case 'if':return 'IF('+print(e.left)+' '+e.op+' '+print(e.right)+', '+print(e.yes)+', '+print(e.no)+')';
 case 'binary':return '('+print(e.left)+' '+e.op+' '+print(e.right)+')';
 }
}
const finite=(n:number):number|null=>Number.isFinite(n)?n:null;
export function evaluateExpression(e:Expr,read:(name:string)=>number|null):number|null{
 const calc=(x:Expr)=>evaluateExpression(x,read);
 if(e.kind==='constant')return e.value;
 if(e.kind==='ref'){const v=read(e.name);return v===null?null:finite(v);}
 if(e.kind==='neg'||e.kind==='abs'){const v=calc(e.arg);return v===null?null:finite(e.kind==='neg'?-v:Math.abs(v));}
 if(e.kind==='coalesce')return calc(e.left)??calc(e.right);
 if(e.kind==='if'){
  const a=calc(e.left),b=calc(e.right);
  const yes=a!==null&&b!==null&&(e.op==='='?a===b:e.op==='!='?a!==b:e.op==='<'?a<b:e.op==='<='?a<=b:e.op==='>'?a>b:a>=b);
  return calc(yes?e.yes:e.no);
 }
 if(e.kind==='binary'){const a=calc(e.left),b=calc(e.right);if(a===null||b===null||(e.op==='/'&&b===0))return null;return finite(e.op==='+'?a+b:e.op==='-'?a-b:e.op==='*'?a*b:a/b);}
 return null;
}
// SQL strings come only from trusted compiler callbacks, fixed tokens and finite constants.
// Guard nonfinite intermediates without duplicating arbitrary subtrees.
function finiteSql(sql:string):string{return "NULLIF(NULLIF(NULLIF(("+sql+"), CAST('NaN' AS DOUBLE)), CAST('Infinity' AS DOUBLE)), CAST('-Infinity' AS DOUBLE))";}
export function compileExpression(e:Expr,read:(name:string)=>string):string{
 const sql=(x:Expr)=>compileExpression(x,read);let result:string;
 switch(e.kind){
 case 'constant':result='CAST('+String(e.value)+' AS DOUBLE)';break;
 case 'ref':result=finiteSql(read(e.name));break;
 case 'neg':result=finiteSql('-('+sql(e.arg)+')');break;
 case 'abs':result=finiteSql('ABS('+sql(e.arg)+')');break;
 case 'coalesce':result='COALESCE('+sql(e.left)+', '+sql(e.right)+')';break;
 case 'if':result='CASE WHEN ('+sql(e.left)+') '+(e.op==='!='?'<>':e.op)+' ('+sql(e.right)+') THEN '+sql(e.yes)+' ELSE '+sql(e.no)+' END';break;
 case 'binary':result=finiteSql('('+sql(e.left)+') '+e.op+' '+(e.op==='/'?'NULLIF('+sql(e.right)+',0)':'('+sql(e.right)+')'));break;
 }
 if(result.length>EXPRESSION_LIMITS.sql)throw invalid('Công thức SQL vượt giới hạn.');
 return result;
}
