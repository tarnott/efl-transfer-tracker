function currentRows(){
  const seen = new Set(); // a domestic deal has an "in" and an "out" row — league view shows it once
  return TRANSFERS.filter(t => {
    if (state.division !== "all" && t.division !== state.division) return false;
    if (state.window !== "all" && t.window !== state.window) return false;
    if (state.club !== "all" && t.club !== state.club) return false;
    if (state.search){
      const q = state.search.toLowerCase();
      if (!(t.player.toLowerCase().includes(q) || t.fromClub.toLowerCase().includes(q) || t.toClub.toLowerCase().includes(q))) return false;
    }
    if (state.club === "all"){
      const k = t.player + "|" + t.transferDate + "|" + t.fromClub + "|" + t.toClub;
      if (seen.has(k)) return false;
      seen.add(k);
    }
    return true;
  });
}
