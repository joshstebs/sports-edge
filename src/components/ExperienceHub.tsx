import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchLedger,
  fetchPerformance,
  type HealthInfo,
  type LedgerPick,
  type PerformanceSummary,
} from '../lib/api';
import {
  americanToDecimal,
  combineDecimalOdds,
  decimalToAmerican,
  evFromConfidence,
  formatAmerican,
  gradeForConfidence,
} from '../lib/odds';
import type { HealthState, SgpLeg } from '../types';
import ParlaySlip, { type SlipSaveStatus } from './ParlaySlip';
import PlayerHeadshot from './PlayerHeadshot';

export type ExperienceId =
  | 'parlay'
  | 'performance'
  | 'provenance'
  | 'prop-lab'
  | 'voice'
  | 'ledger'
  | 'pregame'
  | 'slip'
  | 'research'
  | 'landing';

interface Props {
  legs: SgpLeg[];
  health: HealthState;
  healthInfo: HealthInfo | null;
  onSend: (text: string) => void;
  onOpenChat: () => void;
  onClose: () => void;
  onRemoveLeg: (key: string) => void;
  onClearSlip: () => void;
  onSaveSlip: () => void;
  unsavedCount: number;
  saveStatus: SlipSaveStatus;
}

const META: Array<{ id: ExperienceId; code: string; label: string; hint: string }> = [
  { id: 'parlay', code: 'SE-01', label: 'AI Parlay', hint: 'Verified structured picks' },
  { id: 'performance', code: 'SE-02', label: 'Performance', hint: 'Audited model history' },
  { id: 'provenance', code: 'SE-03', label: 'Provenance', hint: 'Every number has a source' },
  { id: 'prop-lab', code: 'SE-04', label: 'Prop Lab', hint: 'Single-player research' },
  { id: 'voice', code: 'SE-05', label: 'Voice Mode', hint: 'Hands-free analyst' },
  { id: 'ledger', code: 'SE-06', label: 'Receipts', hint: 'Tracked outcomes' },
  { id: 'pregame', code: 'SE-07', label: 'Pregame', hint: 'Research brief launcher' },
  { id: 'slip', code: 'SE-08', label: 'Parlay Slip', hint: 'Real saved selections' },
  { id: 'research', code: 'SE-09', label: 'Research First', hint: 'Evidence-led decision' },
  { id: 'landing', code: 'SE-10', label: 'Landing', hint: 'Conversion first fold' },
];

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function playerName(leg?: SgpLeg): string {
  if (!leg) return '';
  if (leg.player_name) return leg.player_name;
  return String(leg.selection ?? '')
    .replace(/\b(?:over|under)\b[\s\S]*$/i, '')
    .replace(/\bto record\b[\s\S]*$/i, '')
    .replace(/\b\d+(?:\.\d+)?\+?[\s\S]*$/i, '')
    .trim();
}

function safeGrade(confidence?: number): string {
  return typeof confidence === 'number' ? gradeForConfidence(confidence).grade : '—';
}

function displayOdds(leg?: SgpLeg): string {
  if (typeof leg?.odds === 'number') return formatAmerican(leg.odds);
  return leg?.game_odds ? `Game ML ${leg.game_odds}` : 'N/A';
}

function displayEv(leg?: SgpLeg): string {
  if (!leg || typeof leg.odds !== 'number' || typeof leg.confidence !== 'number') return 'N/A';
  const value = evFromConfidence(leg.confidence, leg.odds);
  if (!Number.isFinite(value)) return 'N/A';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function combinedOdds(legs: SgpLeg[]): string {
  if (!legs.length || legs.some((leg) => typeof leg.odds !== 'number')) return 'N/A';
  const product = combineDecimalOdds(legs.map((leg) => americanToDecimal(leg.odds as number)));
  const american = product == null ? null : decimalToAmerican(product);
  return american == null ? 'N/A' : formatAmerican(american);
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-8 w-9 shrink-0" aria-hidden="true">
        <span className="absolute left-0 top-0 h-2.5 w-8 skew-x-[-28deg] rounded-sm bg-edge shadow-[0_0_18px_rgba(145,221,185,.28)]" />
        <span className="absolute left-1 top-2.5 h-2.5 w-7 skew-x-[-28deg] rounded-sm bg-edge2" />
        <span className="absolute left-0 top-5 h-2.5 w-8 skew-x-[-28deg] rounded-sm bg-edge" />
      </div>
      <div className="text-lg font-black uppercase tracking-[0.12em] text-head">Sports<span className="text-edge">Edge</span></div>
    </div>
  );
}

function Shell({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  return <section className={cx('mx-auto min-h-full w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7', centered && 'flex flex-col items-center')}>{children}</section>;
}

function LiveBadges({ health, healthInfo }: { health: HealthState; healthInfo: HealthInfo | null }) {
  const live = health === 'ok';
  const configured = Object.values(healthInfo?.sources ?? {}).filter((value) => {
    return typeof value !== 'object' || value === null || !('available' in value) || (value as { available?: boolean }).available !== false;
  }).length;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-edge/25 bg-edge/[0.045] px-3 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-head">
          <span className={cx('h-2 w-2 rounded-full', live ? 'bg-edge shadow-[0_0_10px_rgba(145,221,185,.7)]' : health === 'checking' ? 'bg-warn' : 'bg-danger')} />
          {live ? 'Live data' : health === 'checking' ? 'Checking data' : 'Data offline'}
        </div>
        <p className="mt-1 text-[10px] text-frost2">{live ? `${configured || 'Backend'} sources connected` : 'Backend status is not currently healthy'}</p>
      </div>
      <div className="rounded-xl border border-sky2/25 bg-sky2/[0.04] px-3 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-sky2">Verified-or-withheld</div>
        <p className="mt-1 text-[10px] text-frost2">Missing prices stay unavailable instead of being invented</p>
      </div>
    </div>
  );
}

function EmptyVerified({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/75 p-6 text-center">
      <p className="text-sm font-bold text-head">No structured picks on the slip yet.</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-frost2">Generate a recommendation first. The redesign intentionally refuses to fill empty states with fake betting data.</p>
      <button onClick={() => onSend('Build me a 3-leg parlay using only verified lines and B-grade-or-better picks.')} className="mt-4 rounded-xl bg-edge px-4 py-2.5 text-xs font-black text-ink">Build verified parlay</button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'cyan' | 'red' }) {
  return <div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-frost2">{label}</p><p className={cx('mt-1 truncate font-mono text-sm font-black text-head', tone === 'green' && 'text-edge', tone === 'cyan' && 'text-sky2', tone === 'red' && 'text-danger')}>{value}</p></div>;
}

function LegCard({ leg, index = 0, condensed = false }: { leg: SgpLeg; index?: number; condensed?: boolean }) {
  const name = playerName(leg);
  const confidence = typeof leg.confidence === 'number' ? leg.confidence : null;
  const verifiedPrice = typeof leg.odds === 'number';
  const gateLabel = leg.__gateNote ? 'Availability noted' : 'Availability screened';
  return (
    <div className="overflow-hidden rounded-2xl border border-edge/20 bg-[linear-gradient(145deg,rgba(23,27,31,.98),rgba(11,13,15,.96))] shadow-[0_18px_50px_rgba(0,0,0,.25)]">
      <div className="flex gap-3 p-3.5 sm:p-4">
        <div className="relative shrink-0">
          <span className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-edge/35 bg-edge/10 font-mono text-[9px] font-black text-edge">{index + 1}</span>
          <PlayerHeadshot sport={leg.sport} name={name} className={condensed ? 'h-16 w-16' : 'h-20 w-20 sm:h-24 sm:w-24'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-base font-black tracking-tight text-head">{name || leg.selection || 'Structured pick'}</p><p className="mt-0.5 line-clamp-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-frost2">{leg.selection || leg.market || 'Selection'}</p></div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-edge/30 bg-edge/5 text-lg font-black text-edge">{safeGrade(leg.confidence)}</div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line/70 pt-2.5">
            <Metric label="Line" value={leg.line != null ? String(leg.line) : '—'} />
            <Metric label="Odds" value={displayOdds(leg)} tone={verifiedPrice ? 'green' : undefined} />
            <Metric label="Model" value={confidence == null ? '—' : `${Math.round(confidence)}%`} tone="cyan" />
            <Metric label="EV" value={displayEv(leg)} tone={verifiedPrice ? 'green' : undefined} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line/60 bg-black/15 px-3.5 py-2.5">
        <span className="rounded-md border border-sky2/20 bg-sky2/[0.035] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-sky2">{verifiedPrice ? 'Priced leg' : 'Price unavailable'}</span>
        <span className="rounded-md border border-sky2/20 bg-sky2/[0.035] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-sky2">{gateLabel}</span>
        {leg.model_version || leg.model_source ? <span className="rounded-md border border-sky2/20 bg-sky2/[0.035] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-sky2">Model provenance</span> : null}
        {leg.sport ? <span className="rounded-md border border-line px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-frost2">{leg.sport}</span> : null}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'cyan' }) {
  return <div className="rounded-2xl border border-line bg-panel/70 p-3.5"><p className="text-[8px] font-black uppercase tracking-[0.12em] text-frost2">{label}</p><p className={cx('mt-2 font-mono text-2xl font-black text-head', tone === 'green' && 'text-edge', tone === 'cyan' && 'text-sky2')}>{value}</p></div>;
}

function ParlayView({ legs, health, healthInfo, onSend }: { legs: SgpLeg[]; health: HealthState; healthInfo: HealthInfo | null; onSend: (text: string) => void }) {
  const visible = legs.slice(0, 3);
  return <Shell><Brand/><div className="mt-4"><LiveBadges health={health} healthInfo={healthInfo}/></div><div className="mt-4 rounded-2xl border border-line bg-panel/70 p-4"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-frost2">You</p><p className="mt-1.5 text-lg font-semibold leading-snug text-head">Build me a 3-leg parlay using only verified lines.</p></div><div className="mt-3 rounded-2xl border border-edge/15 bg-panel/60 p-3.5"><p className="mb-3 text-[9px] font-black uppercase tracking-[0.12em] text-edge">SportsEdge AI · structured response</p>{visible.length ? <div className="space-y-2.5">{visible.map((leg,index)=><LegCard key={`${leg.selection}-${index}`} leg={leg} index={index} condensed/>)}</div> : <EmptyVerified onSend={onSend}/>}</div><div className="sticky bottom-0 mt-3 flex items-center justify-between rounded-2xl border border-edge/25 bg-panel/95 p-4 shadow-[0_-12px_40px_rgba(0,0,0,.35)] backdrop-blur"><div><p className="text-[9px] uppercase tracking-widest text-frost2">Parlay slip</p><p className="mt-1 font-mono text-xl font-black text-edge">{combinedOdds(visible)}</p></div><button onClick={()=>onSend('Review my current parlay slip for risk, correlation, and line verification.')} className="rounded-xl bg-edge px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-ink">Review slip</button></div></Shell>;
}

function PerformanceView() {
  const [data,setData]=useState<PerformanceSummary|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let cancelled=false;fetchPerformance().then((value)=>{if(!cancelled)setData(value.performance)}).catch((err)=>{if(!cancelled)setError(err instanceof Error?err.message:'Performance unavailable')});return()=>{cancelled=true}},[]);
  const pct=(value:number|null|undefined)=>value==null?'—':`${value.toFixed(1)}%`;
  const rows=data?.bySport.slice(0,4)??[];
  return <Shell><Brand/><div className="mt-5 flex items-end justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-frost2">Model Performance</p><h2 className="mt-1 text-2xl font-black text-head">Transparent. Auditable.</h2></div><span className="rounded-lg border border-edge/25 bg-edge/5 px-2 py-1 text-[8px] font-black uppercase text-edge">{data?.storage.durable?'Durable storage':'Performance ledger'}</span></div>{error?<div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger">{error}</div>:null}<div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Graded picks" value={data?String(data.overall.graded):'…'}/><Stat label="Win rate" value={data?pct(data.overall.winRate):'…'} tone="cyan"/><Stat label="ROI" value={data?pct(data.overall.roiPct):'…'} tone="green"/><Stat label="Priced legs" value={data?String(data.overall.priced):'…'} tone="cyan"/></div><div className="mt-3 rounded-2xl border border-line bg-panel/70 p-4"><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-wider text-frost">Performance by sport</p><span className="font-mono text-xs text-edge">7D ROI {data?pct(data.last7.roiPct):'…'}</span></div><div className="mt-4 space-y-3">{rows.map((row)=><div key={row.sport} className="grid grid-cols-[64px_1fr_46px] items-center gap-2"><span className="text-[9px] font-bold text-frost2">{row.sport}</span><div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gradient-to-r from-edge to-sky2" style={{width:`${Math.max(2,Math.min(100,row.winRate??0))}%`}}/></div><span className="text-right font-mono text-[9px] text-head">{pct(row.winRate)}</span></div>)}</div></div><div className="mt-3 overflow-hidden rounded-2xl border border-line bg-panel/70"><div className="border-b border-line px-4 py-3 text-[10px] font-black uppercase tracking-wider text-frost">Recent graded predictions</div><div className="divide-y divide-line/70">{data?.recent.slice(0,6).map((row)=><div key={`${row.predictionId}-${row.selection}`} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-head">{row.selection}</p><p className="mt-0.5 text-[9px] text-frost2">{row.sport} · {row.matchup}</p></div><span className={cx('self-center rounded-md px-2 py-1 text-[9px] font-black uppercase',row.outcome==='won'?'bg-edge/10 text-edge':row.outcome==='lost'?'bg-danger/10 text-danger':'bg-warn/10 text-warn')}>{row.outcome}</span></div>)??<div className="p-4 text-xs text-frost2">Loading graded history…</div>}</div></div></Shell>;
}

function ProvenanceView({ leg, onSend }: { leg?: SgpLeg; onSend:(text:string)=>void }) {
  return <Shell centered><Brand/><h2 className="mt-8 text-center text-4xl font-black leading-[.95] tracking-[-.05em] text-head sm:text-6xl">Every number<br/><span className="text-edge">has a source.</span></h2><div className="mt-7 w-full">{leg?<LegCard leg={leg}/>:<EmptyVerified onSend={onSend}/>}</div><div className="mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-5">{[['Odds','Price when available'],['Availability','Roster/injury screening'],['Games','Official data tools'],['Injuries','Current status tools'],['Model','Versioned evidence']].map(([a,b])=><div key={a} className="rounded-xl border border-line bg-panel/60 p-3 text-center"><p className="text-[8px] font-black uppercase text-sky2">{a}</p><p className="mt-1 text-[9px] text-frost2">{b}</p></div>)}</div><button onClick={()=>onSend('Show the full provenance and evidence for my strongest current pick.')} className="mt-5 rounded-xl border border-edge/30 bg-edge/10 px-5 py-3 text-xs font-black text-edge">Ask SportsEdge</button></Shell>;
}

function PropLabView({ leg, onSend }: { leg?: SgpLeg; onSend:(text:string)=>void }) {
  if(!leg)return <Shell><Brand/><div className="mt-6"><EmptyVerified onSend={onSend}/></div></Shell>;
  const name=playerName(leg); const confidence=typeof leg.confidence==='number'?leg.confidence:null;
  return <Shell><Brand/><div className="mt-5 flex gap-4 rounded-2xl border border-line bg-panel/70 p-4"><PlayerHeadshot sport={leg.sport} name={name} className="h-28 w-28 shrink-0"/><div className="min-w-0 flex-1"><p className="text-[9px] font-black uppercase tracking-wider text-edge">Player Prop Laboratory</p><h2 className="mt-1 text-2xl font-black tracking-tight text-head">{name||'Structured athlete'}</h2><p className="mt-1 text-xs text-frost2">{leg.game||leg.sport||'Current event'}</p><p className="mt-3 text-[9px] text-frost2">{leg.__gateNote||'Recommendation passed the server recommendation pipeline.'}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2"><Stat label="Market line" value={leg.line!=null?String(leg.line):'—'}/><Stat label="Model prob" value={confidence==null?'—':`${Math.round(confidence)}%`} tone="cyan"/><Stat label="EV edge" value={displayEv(leg)} tone="green"/></div><div className="mt-3 rounded-2xl border border-line bg-panel/70 p-4"><div className="flex justify-between text-[9px] font-black uppercase tracking-wider text-frost2"><span>Selected-side probability</span><span>{confidence==null?'—':`${Math.round(confidence)}%`}</span></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gradient-to-r from-edge to-sky2" style={{width:`${confidence??0}%`}}/></div><div className="mt-5 grid h-28 grid-cols-10 items-end gap-1.5">{[38,52,44,61,48,68,72,57,76,81].map((height,index)=><div key={index} className={cx('rounded-t-md border border-white/5',index>=5?'bg-edge/70':'bg-frost2/30')} style={{height:`${height}%`}}/>)}</div><p className="mt-2 text-[9px] text-frost2">The distribution bars are a visual placeholder until a dedicated player-gamelog client endpoint is exposed. The line, price, confidence and EV above come from structured leg data.</p></div><div className="mt-3 rounded-2xl border border-edge/20 bg-edge/[0.035] p-4"><p className="text-[9px] font-black uppercase text-edge">AI takeaway</p><p className="mt-2 text-xs leading-relaxed text-frost">{leg.justification||'Request a current evidence-backed rationale from the analyst.'}</p><button onClick={()=>onSend(`Give me a full evidence-backed breakdown of ${leg.selection??name}, including recent games, injuries, market price, model probability, and risk.`)} className="mt-3 rounded-lg bg-edge px-3 py-2 text-[9px] font-black text-ink">Refresh evidence</button></div></Shell>;
}

function VoiceView({ onSend }: { onSend:(text:string)=>void }) {
  const [listening,setListening]=useState(false); const [text,setText]=useState(''); const recognitionRef=useRef<{stop?:()=>void}|null>(null);
  const speechWindow=window as typeof window & { SpeechRecognition?: new()=>any; webkitSpeechRecognition?: new()=>any };
  const Recognition=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
  const toggle=()=>{if(listening){recognitionRef.current?.stop?.();setListening(false);return;}if(!Recognition)return;const rec=new Recognition();recognitionRef.current=rec;rec.continuous=false;rec.interimResults=true;rec.lang='en-US';rec.onresult=(event:any)=>{let next='';for(let i=event.resultIndex;i<event.results.length;i+=1)next+=event.results[i][0].transcript;setText(next.trim())};rec.onend=()=>setListening(false);rec.onerror=()=>setListening(false);rec.start();setListening(true)};
  return <Shell centered><Brand/><p className="mt-10 text-[10px] font-black uppercase tracking-[.28em] text-frost2">Call SportsEdge</p><h2 className="mt-2 text-3xl font-medium text-head">Voice Mode</h2><button onClick={toggle} disabled={!Recognition} className={cx('relative mt-8 flex h-72 w-72 items-center justify-center rounded-full border',listening?'border-edge/60 shadow-[0_0_80px_rgba(145,221,185,.18)]':'border-line')}><div className="absolute inset-7 rounded-full border border-edge/15"/><div className="flex h-28 items-center gap-1">{Array.from({length:29},(_,i)=><span key={i} className={cx('w-1 rounded-full',listening?'bg-edge':'bg-edge/35')} style={{height:`${20+Math.abs(Math.sin(i*1.7))*72}%`}}/>)}</div></button><p className={cx('mt-5 text-sm font-black uppercase tracking-[.25em]',listening?'text-edge':'text-frost2')}>{Recognition?(listening?'● Live':'Tap waveform to speak'):'Voice recognition unavailable'}</p><div className="mt-6 w-full rounded-2xl border border-line bg-panel/70 p-4 text-left"><p className="text-[9px] font-black uppercase text-frost2">Transcript</p><textarea value={text} onChange={(e)=>setText(e.target.value)} placeholder="Ask SportsEdge out loud or type here…" className="mt-2 min-h-24 w-full resize-none bg-transparent text-sm leading-relaxed text-head outline-none placeholder:text-frost2/50"/><button onClick={()=>{if(text.trim())onSend(text.trim())}} disabled={!text.trim()} className="mt-2 w-full rounded-xl bg-edge px-4 py-3 text-xs font-black text-ink disabled:opacity-40">Send to analyst</button></div></Shell>;
}

function LedgerView() {
  const [picks,setPicks]=useState<LedgerPick[]|null>(null); const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let cancelled=false;fetchLedger().then((result)=>{if(!cancelled)setPicks(result.picks)}).catch((err)=>{if(!cancelled)setError(err instanceof Error?err.message:'Ledger unavailable')});return()=>{cancelled=true}},[]);
  return <Shell centered><Brand/><h2 className="mt-7 text-center text-4xl font-black leading-none tracking-[-.04em] text-head">An AI that<br/><span className="text-edge">keeps receipts.</span></h2><p className="mt-3 text-center text-xs text-frost2">Every saved pick. Every settled outcome. No erased losses.</p><div className="mt-6 w-full overflow-hidden rounded-2xl border border-line bg-panel/75"><div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="text-[9px] font-black uppercase text-edge">Results ledger</span><span className="text-[8px] font-bold uppercase text-sky2">Persisted outcomes</span></div>{error?<div className="p-4 text-xs text-danger">{error}</div>:<div className="divide-y divide-line/70">{picks?.slice(0,8).map((pick)=><div key={pick.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3"><span className={cx('h-3 w-3 rounded-full',pick.status==='won'?'bg-edge':pick.status==='lost'?'bg-danger':pick.status==='push'?'bg-warn':'bg-frost2')}/><div className="min-w-0"><p className="truncate text-xs font-semibold text-head">{pick.selection}</p><p className="mt-0.5 text-[9px] text-frost2">{pick.sport} · {pick.game||pick.eventDate||'Tracked'}</p></div><span className={cx('rounded px-2 py-1 text-[9px] font-black uppercase',pick.status==='won'?'bg-edge/10 text-edge':pick.status==='lost'?'bg-danger/10 text-danger':pick.status==='push'?'bg-warn/10 text-warn':'bg-panel2 text-frost2')}>{pick.status}</span></div>)??<div className="p-4 text-xs text-frost2">Loading tracked picks…</div>}</div>}</div></Shell>;
}

function PregameView({ health, healthInfo, onSend }: { health:HealthState; healthInfo:HealthInfo|null; onSend:(text:string)=>void }) {
  const [matchup,setMatchup]=useState(''); const launch=()=>{if(!matchup.trim())return;onSend(`Build a verified pregame intelligence brief for ${matchup.trim()}. Include injuries, expected/probable lineup, current line and movement if available, key matchup stats, sportsbook availability, and a concise What Matters Most conclusion. Cite source freshness and never fabricate unavailable data.`)};
  return <Shell><Brand/><div className="mt-5"><LiveBadges health={health} healthInfo={healthInfo}/></div><div className="mt-4 rounded-2xl border border-line bg-panel/70 p-5"><p className="text-[9px] font-black uppercase text-edge">Pregame Intelligence Brief</p><h2 className="mt-2 text-2xl font-black text-head">Research one matchup deeply.</h2><p className="mt-2 text-xs leading-relaxed text-frost2">The request uses the existing schedule, injury, lineup, odds, weather and stats tools. Missing data must be called out instead of fabricated.</p><div className="mt-5 flex gap-2"><input value={matchup} onChange={(e)=>setMatchup(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')launch()}} placeholder="e.g. Celtics vs Nuggets tonight" className="min-w-0 flex-1 rounded-xl border border-line bg-ink/70 px-3 py-3 text-sm text-head outline-none focus:border-edge/50"/><button onClick={launch} disabled={!matchup.trim()} className="rounded-xl bg-edge px-4 py-3 text-[10px] font-black uppercase text-ink disabled:opacity-40">Research</button></div></div></Shell>;
}

function SlipView(props: Pick<Props,'legs'|'onRemoveLeg'|'onClearSlip'|'onSaveSlip'|'unsavedCount'|'saveStatus'>) {
  return <Shell><Brand/><div className="mt-5 rounded-2xl border border-line bg-panel/60 p-4"><ParlaySlip legs={props.legs} onRemove={props.onRemoveLeg} onClear={props.onClearSlip} onSave={props.onSaveSlip} unsavedCount={props.unsavedCount} saveStatus={props.saveStatus} className="max-h-[680px]"/></div></Shell>;
}

function ResearchView({ leg, onSend }: { leg?:SgpLeg; onSend:(text:string)=>void }) {
  return <Shell centered><Brand/><h2 className="mt-8 text-center text-5xl font-black leading-[.92] tracking-[-.05em] text-head">Research first.<br/><span className="bg-gradient-to-r from-edge to-sky2 bg-clip-text text-transparent">Pick second.</span></h2><p className="mt-4 text-center text-[11px] font-bold uppercase tracking-[.22em] text-frost2">Evidence before action.</p><div className="mt-7 w-full">{leg?<LegCard leg={leg}/>:<EmptyVerified onSend={onSend}/>}</div><button onClick={()=>onSend('Show me the evidence behind my strongest current structured pick and tell me what could invalidate it.')} className="mt-5 rounded-xl bg-gradient-to-r from-edge to-sky2 px-6 py-3 text-xs font-black text-ink">See the evidence</button></Shell>;
}

function LandingView({ leg, onSend }: { leg?:SgpLeg; onSend:(text:string)=>void }) {
  const [query,setQuery]=useState(''); const submit=()=>{if(query.trim())onSend(query.trim())};
  return <Shell><div className="flex items-center justify-between"><Brand/><span className="rounded-lg border border-edge/25 bg-edge/5 px-2 py-1 text-[8px] font-black uppercase text-edge">Evidence first</span></div><div className="mt-10"><span className="rounded-full border border-edge/25 bg-edge/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-edge">AI-powered sports analysis</span><h2 className="mt-5 max-w-2xl text-5xl font-black leading-[.95] tracking-[-.055em] text-head sm:text-7xl">The AI betting<br/>analyst that<br/><span className="text-edge">shows its work.</span></h2><p className="mt-5 max-w-xl text-sm leading-relaxed text-frost2">Real-time data. Verified-or-withheld prices. Transparent reasoning. More evidence, less guesswork.</p></div><div className="mt-7 flex overflow-hidden rounded-2xl border border-edge/30 bg-panel/75"><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')submit()}} placeholder="Ask about a game, prop, or parlay…" className="min-w-0 flex-1 bg-transparent px-4 py-4 text-sm text-head outline-none"/><button onClick={submit} disabled={!query.trim()} className="m-2 flex h-11 w-11 items-center justify-center rounded-xl bg-edge text-lg font-black text-ink disabled:opacity-40">↑</button></div>{leg?<div className="mt-3"><LegCard leg={leg} condensed/></div>:null}</Shell>;
}

export default function ExperienceHub(props: Props) {
  const [active,setActive]=useState<ExperienceId>('parlay');
  const primary=props.legs[0];
  const view=()=>{switch(active){
    case'parlay':return <ParlayView legs={props.legs} health={props.health} healthInfo={props.healthInfo} onSend={props.onSend}/>;
    case'performance':return <PerformanceView/>;
    case'provenance':return <ProvenanceView leg={primary} onSend={props.onSend}/>;
    case'prop-lab':return <PropLabView leg={primary} onSend={props.onSend}/>;
    case'voice':return <VoiceView onSend={props.onSend}/>;
    case'ledger':return <LedgerView/>;
    case'pregame':return <PregameView health={props.health} healthInfo={props.healthInfo} onSend={props.onSend}/>;
    case'slip':return <SlipView legs={props.legs} onRemoveLeg={props.onRemoveLeg} onClearSlip={props.onClearSlip} onSaveSlip={props.onSaveSlip} unsavedCount={props.unsavedCount} saveStatus={props.saveStatus}/>;
    case'research':return <ResearchView leg={primary} onSend={props.onSend}/>;
    case'landing':return <LandingView leg={primary} onSend={props.onSend}/>;
  }};
  return <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_50%_-10%,rgba(145,221,185,.07),transparent_35%),linear-gradient(rgba(255,255,255,.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.012)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]"><div className="shrink-0 border-b border-line bg-ink/95 px-3 py-2 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center gap-2"><button onClick={props.onClose} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-frost2 hover:text-head" aria-label="Back to SportsEdge">←</button><div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">{META.map((item)=><button key={item.id} onClick={()=>setActive(item.id)} title={item.hint} className={cx('shrink-0 rounded-lg border px-2.5 py-2 text-left',active===item.id?'border-edge/35 bg-edge/10 text-edge':'border-line bg-panel/60 text-frost2 hover:text-head')}><span className="block font-mono text-[7px] opacity-70">{item.code}</span><span className="mt-0.5 block text-[9px] font-black uppercase tracking-wide">{item.label}</span></button>)}</div></div></div><div className="min-h-0 flex-1 overflow-y-auto">{view()}</div></div>;
}
