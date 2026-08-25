import { useEffect, useMemo, useState } from 'react';
import { fetchPlayerProfile, type PlayerProfile } from '../lib/api';

interface Props {
  sport?: string | null;
  name?: string | null;
  className?: string;
  showTeamMark?: boolean;
}

const cache = new Map<string, PlayerProfile | null>();

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'SE';
}

export default function PlayerHeadshot({ sport, name, className = '', showTeamMark = true }: Props) {
  const key = useMemo(() => `${String(sport ?? '').toUpperCase()}:${String(name ?? '').trim()}`, [sport, name]);
  const [profile, setProfile] = useState<PlayerProfile | null>(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const playerName = String(name ?? '').trim();
    const league = String(sport ?? '').trim();
    if (!playerName || !league || !/^(MLB|NFL|NBA|NHL)$/i.test(league)) return;
    if (cache.has(key)) {
      setProfile(cache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    fetchPlayerProfile(league, playerName)
      .then((result) => {
        if (cancelled) return;
        const next = result.available && result.player ? result.player : null;
        cache.set(key, next);
        setProfile(next);
      })
      .catch(() => {
        if (cancelled) return;
        cache.set(key, null);
        setProfile(null);
      });
    return () => { cancelled = true; };
  }, [key, name, sport]);

  const label = String(name ?? '').trim() || 'SportsEdge';
  const canShowImage = Boolean(profile?.headshotUrl) && !failed;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-edge/20 via-panel2 to-sky2/10 ${className}`}
      title={profile ? `${profile.name} · ${profile.teamName} · ${profile.position ?? 'player'} · ESPN roster` : label}
    >
      {canShowImage ? (
        <img
          src={profile!.headshotUrl!}
          alt={`${profile!.name} headshot`}
          className="h-full w-full object-cover object-top"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_25%,rgba(145,221,185,.24),transparent_55%)] text-xl font-black tracking-tight text-head">
          {initials(label)}
        </div>
      )}
      {showTeamMark && profile?.teamAbbreviation ? (
        <span className="absolute bottom-1.5 right-1.5 rounded-md border border-white/10 bg-black/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-edge backdrop-blur">
          {profile.teamAbbreviation}
        </span>
      ) : null}
    </div>
  );
}
