"""Builds Wordezy Ladder's word lists.

Usage: python3 scripts/build_words.py src/data/words.ts <download-dir>

Inputs (public GitHub repos, cloned into <download-dir>):
  - dict/popular.txt   common subset of the ENABLE word list (dolph/dictionary)
  - fw/content/2018/en/en_50k.txt  OpenSubtitles frequency ranks (hermitdave/FrequencyWords)

Output, per word length (4 and 5):
  - VALID: every word a player may type as a step.
  - CORE: the everyday subset of VALID that par (the shortest route) and hints
    are worked out on, so par never depends on a word like FESS or SEAR. A
    player who knows a rarer word may beat par, which is fine.
  - ENDS: common, well-known words used as a puzzle's start or target.
"""
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

OUT = Path(sys.argv[1])
DL = Path(sys.argv[2])

popular = {w.strip() for w in open(DL / "dict/popular.txt") if w.strip().isalpha() and w.strip().islower()}
rank = {}
for i, line in enumerate(open(DL / "fw/content/2018/en/en_50k.txt")):
    w = line.split()[0]
    if w.isalpha() and w.islower() and w not in rank:
        rank[w] = i

# Never typed into a family-friendly ladder, never shown as an answer.
BLOCK = set("""
sex sexy nude porn rape rapes kill dead died dies gore guns shot stab bomb nazi slut whore fuck fucks
cunt dick dicks cock cocks suck sucks tits boob boobs butt piss poop shit crap damn hell homo dyke fags
pimp pimps jizz anal anus arse arses dong dork twat wank weed dope drug drugs coke porn porno horny
lust nazi jews jesus satan fart farts pee pees puke rapist killer dildo penis semen vagina boner
bitch pussy prick raped naked booty kinky fanny slave slaves sissy drunk death dying bleed lynch butch
wench spank fatty bowel trans coma pope scum dumb goddamn bible holy
blah geez gosh heck jeez nope oops ouch whew yikes youse hallo golly homey bleep quid
""".split())
NAMES = set("""
john jack mike tony nick jake matt carl rick josh dean joey beth jess cole maya toby jill paul mark
ross kate anna sara emma lucy mary jane adam eric ryan ivan alex mona nora rosa tina gary dave sean
kent kirk mick chad hong yang ford ohio iowa utah rome asia bach marx
peter henry harry jimmy billy tommy bobby roger maria jerry kelly laura jenny louis terry jesse molly
sally donna nancy randy ralph shawn sonny riley colin benny homer frank perry romeo erica tracy
alan baba brad cory hank kane mack marc milo ruth saul shaw tate troy vera
belle brock chang chico chile china dutch greek jones kerry lacey marge morse nelly paris patsy roman
serge smith sykes wally willy missy triad
""".split())
FUNCTION = set("""
that have your just here they will when were then than some very only over into also such upon whom
thou thee from with this what them been
about their there where which would should could after again those these other while since until
under above among whose
""".split())

def plural(w):
    return w.endswith("s") and (w[:-1] in popular or (w.endswith("es") and w[:-2] in popular))

def neighbours_index(words):
    buckets = defaultdict(list)
    for w in words:
        for i in range(len(w)):
            buckets[w[:i] + "_" + w[i + 1:]].append(w)
    adj = {w: set() for w in words}
    for group in buckets.values():
        for a in group:
            for b in group:
                if a != b:
                    adj[a].add(b)
    return adj

def largest_component(adj):
    seen, best = set(), set()
    for start in adj:
        if start in seen:
            continue
        comp, q = {start}, deque([start])
        while q:
            for nb in adj[q.popleft()]:
                if nb not in comp:
                    comp.add(nb); q.append(nb)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    return best

result = {}
for n, valid_limit, core_limit, end_limit in [(4, 9000, 15000, 700), (5, 12000, 16000, 700)]:
    valid = sorted(
        w for w in popular
        if len(w) == n and w not in BLOCK and w not in NAMES and len(set(w)) >= 2
        and rank.get(w, 10**9) < valid_limit * 4
    )
    # Subtitle-frequency quirks: these rank high only as apostrophe-less
    # spellings of contractions, not as the words themselves.
    contraction_ghosts = {"cant", "wont", "dont", "isnt", "aint", "shes", "hes", "ill", "youre", "theyre", "didnt", "wasnt"}
    core = sorted(w for w in valid if rank.get(w, 10**9) < core_limit and w not in contraction_ghosts)
    adj = neighbours_index(core)
    # Only words connected to the main web can ever be part of a puzzle.
    main = largest_component(adj)
    ends = [
        w for w in core
        if w in main and w in rank and not plural(w) and w not in FUNCTION and len(adj[w]) >= 2
    ]
    ends.sort(key=lambda w: rank[w])
    ends = sorted(ends[:end_limit])
    result[n] = {"valid": valid, "core": sorted(main), "ends": ends}
    print(n, "valid", len(valid), "core", len(core), "connected", len(main), "ends", len(ends), file=sys.stderr)

lines = [
    "// GENERATED by scripts/build_words.py — do not edit by hand.",
    "// VALID: words a player may type as a step. CORE: the everyday subset par",
    "// and hints use. ENDS: well-known start/target words. Sources: ENABLE list",
    "// (public domain) filtered to everyday usage; offensive words and names removed.",
    "",
]
for n in (4, 5):
    lines.append(f"export const VALID_{n} = {json.dumps(' '.join(result[n]['valid']))};")
    lines.append(f"export const CORE_{n} = {json.dumps(' '.join(result[n]['core']))};")
    lines.append(f"export const ENDS_{n} = {json.dumps(' '.join(result[n]['ends']))};")
    lines.append("")
OUT.write_text("\n".join(lines))
print("wrote", OUT, OUT.stat().st_size, "bytes", file=sys.stderr)
