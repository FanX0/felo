const TRACK_NUM_PREFIX_REGEX = /^(?:[a-z]?\d{1,3}[.\s_-]+|\d{1,2}\s*-\s*)+/i;
const UNWANTED_VERSION_KEYWORDS = [
  "remix",
  "live",
  "karaoke",
  "instrumental",
  "acoustic",
  "cover",
  "slowed",
  "reverb",
  "tribute",
  "parody",
  "reaction",
  "snippet",
  "teaser",
  "sped up",
  "nightcore",
  "bass boosted",
  "clean version",
  "ringtone",
  "tutorial",
  "mashup",
  "radio edit",
  "extended mix",
  "club mix",
  "hour loop",
  "10 hours"
];
function stripJunkTags(text) {
  if (!text) return "";
  return text.replace(/\s*([[(][^\])]*[\])])\s*/g, (match, inner) => {
    const lower = inner.toLowerCase();
    const hasVersionKeyword = UNWANTED_VERSION_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasVersionKeyword) {
      return match;
    }
    const isJunk = /(?:official|video|audio|visualizer|lyrics?|4k|hd|hq|explicit|clean|mv|clip|remaster|\b(?:19|20)\d{2}\b)/i.test(
      lower
    );
    if (isJunk) {
      return " ";
    }
    return match;
  }).replace(
    /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|visualizer|hd|4k)\s*$/gi,
    ""
  );
}
function normalizeForMatching(value) {
  if (!value) return "";
  const cleaned = stripJunkTags(value);
  return cleaned.toLowerCase().replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, "").replace(/\s*\(\d+\)\s*$/g, "").replace(TRACK_NUM_PREFIX_REGEX, "").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}
function cleanSearchQuery(artist, title, fallbackQuery) {
  const cleanTitle = stripJunkTags(title || "").replace(TRACK_NUM_PREFIX_REGEX, "").replace(/\s*\([^)]*feat\.[^)]*\)/gi, "").replace(/\s*\[[^\]]*feat\.[^\]]*\]/gi, "").replace(/\s+feat\..*/gi, "").replace(/\s+ft\..*/gi, "").replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();
  const cleanArtist = (artist || "").replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, "").replace(/\s*feat\..*/gi, "").replace(/\s*ft\..*/gi, "").replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();
  if (cleanTitle && cleanArtist) {
    const normT = cleanTitle.toLowerCase();
    const normA = cleanArtist.toLowerCase();
    if (normT.startsWith(`${normA} - `) || normT.startsWith(`${normA} `)) {
      return cleanTitle;
    }
    return `${cleanArtist} ${cleanTitle}`;
  }
  if (cleanTitle) return cleanTitle;
  if (cleanArtist) return cleanArtist;
  if (fallbackQuery) {
    return stripJunkTags(fallbackQuery).replace(TRACK_NUM_PREFIX_REGEX, "").replace(/\b(?:song|songs|lagu|track|audio|music)\b/gi, "").replace(/\s+/g, " ").trim();
  }
  return "";
}
function parseSmartQuery(raw, explicitArtist) {
  if (!raw) {
    return { title: "", artist: explicitArtist?.trim() || "", cleanQuery: "", isCollaboration: false };
  }
  let text = stripJunkTags(raw)
    .replace(/^(?:play|putar|dengarkan|listen to|put on)\s+(?:this|that|the|a|song|track|lagu)?\s*/i, "")
    .replace(/^(?:play|putar|dengarkan|listen to|put on)\s+/i, "")
    .replace(/^(?:this|that)\s+/i, "")
    .replace(TRACK_NUM_PREFIX_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanQuery = text.replace(/\b(?:song|songs|lagu|track|audio|music)\b/gi, "").replace(/\s+/g, " ").trim();
  if (explicitArtist && explicitArtist.trim()) {
    const artist = explicitArtist.trim();
    const title = cleanQuery.replace(new RegExp(`\\b${artist}\\b`, "gi"), "").trim() || cleanQuery;
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`.trim(),
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    };
  }
  const byMatch = cleanQuery.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i);
  if (byMatch) {
    const title = byMatch[1].trim();
    const artist = byMatch[2].trim();
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`,
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    };
  }
  const dashMatch = cleanQuery.match(/^(.+?)\s*-\s*(.+)$/i);
  if (dashMatch) {
    const artist = dashMatch[1].trim();
    const title = dashMatch[2].trim();
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`,
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    };
  }
  const isCollaboration = /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(cleanQuery);
  return {
    title: cleanQuery,
    artist: "",
    cleanQuery,
    isCollaboration
  };
}
function parseAudioFilePath(rawPath) {
  if (!rawPath) return { title: "", artist: "", album: "" };
  const normalized = rawPath.replace(/^@@/, "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const rawFileName = parts[parts.length - 1] || normalized;
  const fileNameWithoutExt = rawFileName.replace(/\.[^.]+$/, "").trim();
  const cleanBase = fileNameWithoutExt.replace(TRACK_NUM_PREFIX_REGEX, "").trim();
  let title = cleanBase;
  let artist = "";
  let album = "";
  if (cleanBase.includes(" - ")) {
    const subParts = cleanBase.split(" - ").map((s) => s.trim()).filter(Boolean);
    if (subParts.length === 2) {
      artist = subParts[0];
      title = subParts[1];
    } else if (subParts.length >= 3) {
      artist = subParts[0];
      title = subParts[subParts.length - 1];
      album = subParts.slice(1, -1).join(" - ");
    }
  }
  if (!artist && parts.length > 1) {
    const parentFolder = parts[parts.length - 2];
    if (parentFolder.includes(" - ")) {
      const folderParts = parentFolder.split(" - ").map((s) => s.trim()).filter(Boolean);
      if (folderParts.length >= 2) {
        artist = folderParts[0];
        album = folderParts.slice(1).join(" - ");
      }
    } else if (parts.length > 2) {
      const grandParentFolder = parts[parts.length - 3];
      artist = grandParentFolder.replace(/^[0-9_.\s-]+/, "").trim();
      album = parentFolder.replace(/^[0-9_.\s-]+/, "").trim();
    } else {
      album = parentFolder;
    }
  }
  title = title.replace(/\s*\[(?:flac|mp3|wav|24bit|16bit|lossless|cd|web)[^\]]*\]/gi, "").trim();
  album = album.replace(/\s*\[(?:flac|mp3|wav|24bit|16bit|lossless|cd|web)[^\]]*\]/gi, "").trim();
  return { title: title || cleanBase, artist, album };
}
function getWordTokens(text) {
  const norm = normalizeForMatching(text);
  return new Set(norm.split(/\s+/).filter((word) => word.length >= 2));
}
function tokenSimilarity(a, b) {
  const setA = getWordTokens(a);
  const setB = getWordTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = (/* @__PURE__ */ new Set([...setA, ...setB])).size;
  return union > 0 ? intersection / union : 0;
}
function stringSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.7) {
    return 0;
  }
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }
  const distance = prev[n];
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : Math.max(0, 1 - distance / maxLen);
}
function parseDurationToSeconds(duration) {
  if (!duration) return 0;
  if (typeof duration === "number") return Number.isFinite(duration) ? duration : 0;
  const match = duration.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!match) {
    const numeric = parseFloat(duration);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  return hours * 3600 + minutes * 60 + seconds;
}
function findMatchingLibrarySong(targetTitle, targetArtist, librarySongs) {
  if (!librarySongs || librarySongs.length === 0) return void 0;
  const normTargetTitle = normalizeForMatching(targetTitle);
  const normTargetArtist = normalizeForMatching(targetArtist);
  if (!normTargetTitle) return void 0;
  const targetFull = normalizeForMatching(`${targetArtist} ${targetTitle}`);
  const targetFullRev = normalizeForMatching(`${targetTitle} ${targetArtist}`);
  return librarySongs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith("virtual:")) return false;
    const normLocalTitle = normalizeForMatching(song.title || "");
    const normLocalArtist = normalizeForMatching(song.artist || "");
    if (!normLocalTitle) return false;
    if (normLocalTitle === normTargetTitle) {
      if (!normTargetArtist || !normLocalArtist || normLocalArtist === normTargetArtist) {
        return true;
      }
      if (normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist)) {
        return true;
      }
    }
    const localFull = normalizeForMatching(`${song.artist || ""} ${song.title || ""}`);
    const localFullRev = normalizeForMatching(`${song.title || ""} ${song.artist || ""}`);
    if (localFull === targetFull || localFull === targetFullRev || localFullRev === targetFull || localFullRev === targetFullRev) {
      return true;
    }
    if (normTargetTitle.length >= 4 && normLocalTitle.includes(normTargetTitle)) {
      const hasArtistMatch = normTargetArtist && normLocalArtist && (normTargetArtist === normLocalArtist || normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist) || normLocalTitle.includes(normTargetArtist));
      if (hasArtistMatch) {
        return true;
      }
    }
    if (normLocalTitle.length >= 4 && normTargetTitle.includes(normLocalTitle)) {
      const hasArtistMatch = normTargetArtist && normLocalArtist && (normTargetArtist === normLocalArtist || normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist) || normTargetTitle.includes(normLocalArtist));
      if (hasArtistMatch) {
        return true;
      }
    }
    return false;
  });
}
function isSongInLibrary(targetTitle, targetArtist, librarySongs) {
  return Boolean(findMatchingLibrarySong(targetTitle, targetArtist, librarySongs));
}
const TRIBUTE_COVER_PATTERNS = [
  /\btribute\b/i,
  /\boriginally performed by\b/i,
  /\bin the style of\b/i,
  /\bmade famous by\b/i,
  /\bkaraoke version\b/i,
  /\bpiano tribute\b/i,
  /\bstring quartet tribute\b/i,
  /\bbacking track\b/i
];
function cleanProviderArtist(artist) {
  if (!artist) return "";
  return artist.replace(/\s*-\s*topic\b/gi, "").replace(/\bvevo\b/gi, "").replace(/\s+official\s+(?:channel|artist\s+channel)?\b/gi, "").replace(/\s*\((?:official|topic|audio)\)\s*$/gi, "").trim();
}
function scoreProviderMatch(target, candidate) {
  const normTargetTitle = normalizeForMatching(target.title);
  const normTargetArtist = normalizeForMatching(cleanProviderArtist(target.artist || ""));
  let candTitle = candidate.title;
  let candArtist = cleanProviderArtist(candidate.artist || "");
  if (candTitle.includes(" - ") && (!candArtist || candArtist.startsWith("Peer:"))) {
    const sub = candTitle.split(" - ");
    if (sub.length === 2) {
      candArtist = cleanProviderArtist(sub[0].trim());
      candTitle = sub[1].trim();
    }
  }
  const normCandTitle = normalizeForMatching(candTitle);
  const normCandArtist = normalizeForMatching(candArtist);
  const candExtra = normalizeForMatching(`${candidate.meta || ""} ${candidate.description || ""}`);
  const rawCombinedCand = `${candidate.title} ${candidate.artist || ""} ${candidate.meta || ""} ${candidate.description || ""}`;
  let score = 0;
  let rejectReason;
  for (const pattern of TRIBUTE_COVER_PATTERNS) {
    if (pattern.test(rawCombinedCand) && !pattern.test(target.title)) {
      return {
        score: 0,
        confidence: "Mismatched",
        isAcceptable: false,
        rejectReason: "Candidate is a tribute, cover, or karaoke recording"
      };
    }
  }
  if (normTargetTitle) {
    if (normTargetTitle === normCandTitle) {
      score += 55;
    } else {
      const tokenSim = tokenSimilarity(normTargetTitle, normCandTitle);
      const editSim = stringSimilarity(normTargetTitle, normCandTitle);
      let combinedSim = 0.4 * tokenSim + 0.6 * editSim;
      if (!normTargetArtist) {
        const normCandCombined = `${normCandArtist} ${normCandTitle}`.trim();
        const combTokenSim = tokenSimilarity(normTargetTitle, normCandCombined);
        const combEditSim = stringSimilarity(normTargetTitle, normCandCombined);
        const combSim = 0.4 * combTokenSim + 0.6 * combEditSim;
        const targetTokens = normTargetTitle.split(" ").filter(Boolean);
        const candWords = `${normCandCombined} ${candExtra}`.split(" ").filter(Boolean);
        const matchedCount = targetTokens.filter(
          (token) => candWords.some((w) => w === token || stringSimilarity(w, token) >= 0.75)
        ).length;
        const tokenCoverage = targetTokens.length > 0 ? matchedCount / targetTokens.length : 0;
        combinedSim = Math.max(combinedSim, combSim, tokenCoverage * 0.95);
      }
      if (normCandTitle.includes(normTargetTitle)) {
        score += Math.max(42, Math.round(combinedSim * 52));
      } else {
        score += Math.round(combinedSim * 48);
      }
    }
  }
  if (normTargetArtist) {
    const isPeerArtist = normCandArtist.startsWith("peer") || normCandArtist.includes("soulseek");
    if (normCandArtist && !isPeerArtist && (normCandArtist === normTargetArtist || normCandArtist.includes(normTargetArtist) || normTargetArtist.includes(normCandArtist))) {
      score += 35;
    } else if (normCandTitle.includes(normTargetArtist) || candExtra.includes(normTargetArtist)) {
      score += 30;
    } else if (normCandArtist && !isPeerArtist && normCandArtist !== "youtube") {
      score -= 45;
      rejectReason = "Different musical artist";
    } else {
      score += 15;
    }
  } else {
    const targetTokens = normTargetTitle.split(" ").filter(Boolean);
    const candArtistWords = normCandArtist.split(" ").filter(Boolean);
    const matchedArtistCount = targetTokens.filter(
      (token) => candArtistWords.some((w) => w === token || stringSimilarity(w, token) >= 0.75)
    ).length;
    if (matchedArtistCount > 0) {
      score += Math.min(35, 20 + matchedArtistCount * 8);
    } else {
      score += 20;
    }
  }
  const targetSeconds = parseDurationToSeconds(target.duration);
  const candDurationStr = candidate.meta?.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)?.[1];
  const candSeconds = candidate.duration ? parseDurationToSeconds(candidate.duration) : candDurationStr ? parseDurationToSeconds(candDurationStr) : 0;
  let durationDelta = null;
  if (targetSeconds > 0 && candSeconds > 0) {
    durationDelta = Math.abs(targetSeconds - candSeconds);
    if (durationDelta <= 3) {
      score += 20;
    } else if (durationDelta <= 8) {
      score += 15;
    } else if (durationDelta <= 14) {
      score += 8;
    } else if (durationDelta > 90) {
      score -= 90;
      rejectReason = `Duration delta excessive (${durationDelta}s)`;
    } else if (durationDelta > 35) {
      score -= 70;
      rejectReason = `Duration delta high (${durationDelta}s)`;
    } else if (durationDelta > 18) {
      score -= 40;
      rejectReason = `Duration delta suspicious (${durationDelta}s)`;
    }
  }
  let isStudioMatch = true;
  const fullCandText = `${normCandTitle} ${normCandArtist} ${candExtra}`;
  for (const kw of UNWANTED_VERSION_KEYWORDS) {
    const targetHasKw = normTargetTitle.includes(kw);
    const candHasKw = fullCandText.includes(kw);
    if (candHasKw && !targetHasKw) {
      const isFatalJunk = [
        "karaoke",
        "instrumental",
        "slowed",
        "reverb",
        "tribute",
        "parody",
        "reaction",
        "snippet",
        "teaser",
        "sped up",
        "nightcore",
        "bass boosted",
        "ringtone",
        "tutorial",
        "mashup"
      ].includes(kw);
      if (isFatalJunk) {
        score -= 65;
        isStudioMatch = false;
        rejectReason = `Candidate contains unwanted version tag "${kw}"`;
      } else if (kw === "live" || kw === "acoustic") {
        const isSession = /\b(?:session|special live|studio live|colors|acoustic)\b/i.test(fullCandText);
        if (!normTargetArtist || isSession) {
          score -= 10;
        } else {
          score -= 40;
          isStudioMatch = false;
          rejectReason = `Candidate contains unwanted version tag "${kw}"`;
        }
      } else {
        score -= 30;
        isStudioMatch = false;
      }
    } else if (targetHasKw && candHasKw) {
      score += 20;
    } else if (targetHasKw && !candHasKw) {
      score -= 35;
      rejectReason = `Target requested "${kw}" version but candidate is regular`;
    }
  }
  score = Math.max(0, Math.min(100, score));
  let confidence = "Low match";
  if (score >= 85) confidence = "Exact match";
  else if (score >= 70) confidence = "High match";
  else if (score >= 60) confidence = "Provider match";
  else if (score < 50) confidence = "Mismatched";
  return {
    score,
    confidence,
    isAcceptable: score >= 60 && !rejectReason,
    durationDelta,
    isStudioMatch,
    rejectReason
  };
}
function validateTrackIdentity(target, candidate) {
  const result = scoreProviderMatch(target, candidate);
  return {
    isValid: result.isAcceptable,
    score: result.score,
    reason: result.rejectReason
  };
}
export {
  UNWANTED_VERSION_KEYWORDS,
  cleanProviderArtist,
  cleanSearchQuery,
  findMatchingLibrarySong,
  isSongInLibrary,
  normalizeForMatching,
  parseAudioFilePath,
  parseDurationToSeconds,
  parseSmartQuery,
  scoreProviderMatch,
  stringSimilarity,
  stripJunkTags,
  validateTrackIdentity
};
