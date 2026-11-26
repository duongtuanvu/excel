// Fixed-point decimal arithmetic; no Number conversion of stored decimal values.
import type {Expr} from './pivot-expression.ts';
export type Fixed=bigint|null;
export const DECIMAL_MAX=10n**30n-1n;
export const DECIMAL_SCALES=[0,1,2,3,4,5,6] as const;
export function decimalBound(v:bigint):bigint{
 if(v>DECIMAL_MAX||v< -DECIMAL_MAX)throw Error('PIVOT_DECIMAL_OVERFLOW: Kết quả vượt 30 chữ số đã scale.');
 return v;
}
export function decimalFactor(scale:number):bigint{
 if(!Number.isInteger(scale)||scale<0||scale>6)throw Error('PIVOT_DECIMAL_SCALE: Scale từ 0 đến 6.');
 return 10n**BigInt(scale);
}
// Strict parsing of decimal strings, including bounded scientific notation.
// Do not silently round inputs with more significant fractional digits than scale.
export function parseFixed(input:string,scale:number):bigint{
 decimalFactor(scale);
 if(input.length>128)throw Error('PIVOT_DECIMAL_INPUT: Số vượt giới hạn độ dài.');
 const m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,3}))?$/.exec(input.trim());
 if(!m)throw Error('PIVOT_DECIMAL_INPUT: Cần số thập phân chuẩn, không có dấu phân cách hàng nghìn.');
 const fraction=m[3]??m[4]??'',exponent=Number(m[5]??0);
 if(Math.abs(exponent)>100)throw Error('PIVOT_DECIMAL_INPUT: Số mũ ngoài giới hạn.');
 const digits=((m[2]??'')+fraction).replace(/^0+/,'')||'0';
 if(digits==='0')return 0n;
 const shift=scale+exponent-fraction.length;
 if(shift>30||digits.length+shift>30)throw Error('PIVOT_DECIMAL_OVERFLOW: Giá trị vượt giới hạn.');
 if(shift<0&&(digits.length< -shift||!/^[0]*$/.test(digits.slice(shift))))throw Error('PIVOT_DECIMAL_SCALE: Dữ liệu có nhiều chữ số thập phân hơn scale.');
 const scaled=shift<0?digits.slice(0,shift)||'0':digits+'0'.repeat(shift);
 return decimalBound(BigInt((m[1]==='-'?'-':'')+scaled));
}
// Round half away from zero, with arbitrary integer intermediates.
export function roundedDivide(a:bigint,b:bigint):Fixed{
 if(b===0n)return null;
 const sign=(a<0n)!==(b<0n)?-1n:1n,x=a<0n?-a:a,y=b<0n?-b:b;
 return sign*(x/y+((x%y)*2n>=y?1n:0n));
}
export function fixedArithmetic(a:Fixed,b:Fixed,op:'+'|'-'|'*'|'/',factor:bigint):Fixed{
 if(a===null||b===null)return null;
 const v=op==='+'?a+b:op==='-'?a-b:op==='*'?roundedDivide(a*b,factor):roundedDivide(a*factor,b);
 return v===null?null:decimalBound(v);
}
export function fixedString(v:bigint,scale:number):string{
 const sign=v<0n?'-':'',digits=(v<0n?-v:v).toString().padStart(scale+1,'0');
 return sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
}
export function formatFixed(value:string,scale:number,decimals:number,format:'number'|'vnd'|'percent'):string{
 const v=parseFixed(value,scale)*(format==='percent'?100n:1n);
 const scaled=decimals>=scale?v*10n**BigInt(decimals-scale):roundedDivide(v,10n**BigInt(scale-decimals))!;
 const [whole,frac]=fixedString(scaled,decimals).split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(frac?','+frac:'')+(format==='percent'?'%':format==='vnd'?' ₫':'');
}
export function evaluateFixed(e:Expr,read:(name:string)=>Fixed,scale:number):Fixed{
 const calc=(x:Expr)=>evaluateFixed(x,read,scale),factor=decimalFactor(scale);
 if(e.kind==='constant')return parseFixed(e.literal??String(e.value),scale);
 if(e.kind==='ref')return read(e.name);
 if(e.kind==='neg'||e.kind==='abs'){const v=calc(e.arg);return v===null?null:e.kind==='neg'?-v:v<0n?-v:v;}
 if(e.kind==='coalesce')return calc(e.left)??calc(e.right);
 if(e.kind==='if'){const a=calc(e.left),b=calc(e.right);const yes=a!==null&&b!==null&&(e.op==='='?a===b:e.op==='!='?a!==b:e.op==='<'?a<b:e.op==='<='?a<=b:e.op==='>'?a>b:a>=b);return calc(yes?e.yes:e.no);}
 if(e.kind==='binary')return fixedArithmetic(calc(e.left),calc(e.right),e.op,factor);
 return null;
}
