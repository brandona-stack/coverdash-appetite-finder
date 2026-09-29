// Plain-English class search.
// Blends three signals into one ranking:
//   1. The US Census Bureau's BEACON model (description -> NAICS), from the JS port in
//      @cajuncodemonkey/naics-search, trimmed to single words (public/naics-model.json).
//   2. Matching against the NAICS titles plus Coverdash's own everyday terms (SYNONYMS below).
//   3. A small boost for classes we quote often.
//
// BEACON port license:
/*
MIT License

Copyright (c) 2026 Ken Courville

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(function (root) {
//#region src/naics/stem.ts
/**
* TS port of BEACON's clean_text()/__stem() (beacon/beacon.py L285-821) — the
* NLTK Porter2/Snowball English stemmer with BEACON's stop-word, special-word,
* and mapping overrides. Ported line-for-line to preserve exact parity
* (§V6) — do not "simplify" the suffix-step logic, order and break-on-first-
* match behavior are load-bearing.
*/
const STOP_WORDS = /* @__PURE__ */ new Set([
	"a",
	"am",
	"an",
	"and",
	"are",
	"as",
	"but",
	"by",
	"for",
	"from",
	"i",
	"if",
	"in",
	"is",
	"it",
	"on",
	"or",
	"other",
	"since",
	"so",
	"the",
	"this",
	"to",
	"we",
	"with",
	"you"
]);
const VOWELS = "aeiouy";
const DOUBLE_CONSONANTS = [
	"bb",
	"dd",
	"ff",
	"gg",
	"mm",
	"nn",
	"pp",
	"rr",
	"tt"
];
const LI_ENDING = "cdeghkmnrt";
const STEP1A_SUFFIXES = [
	"sses",
	"ied",
	"ies",
	"us",
	"ss",
	"s"
];
const STEP1B_SUFFIXES = [
	"eedly",
	"ingly",
	"edly",
	"eed",
	"ing",
	"ed"
];
const STEP2_SUFFIXES = [
	"ization",
	"ational",
	"fulness",
	"ousness",
	"iveness",
	"tional",
	"biliti",
	"lessli",
	"entli",
	"ation",
	"alism",
	"aliti",
	"ousli",
	"iviti",
	"fulli",
	"enci",
	"anci",
	"abli",
	"izer",
	"ator",
	"alli",
	"bli",
	"ogi",
	"li"
];
const STEP3_SUFFIXES = [
	"ational",
	"tional",
	"alize",
	"icate",
	"iciti",
	"ative",
	"ical",
	"ness",
	"ful"
];
const STEP4_SUFFIXES = [
	"ement",
	"ance",
	"ence",
	"able",
	"ible",
	"ment",
	"ant",
	"ent",
	"ism",
	"ate",
	"iti",
	"ous",
	"ive",
	"ize",
	"ion",
	"al",
	"er",
	"ic"
];
const STEP6_SUFFIXES = [
	"curist",
	"graphi",
	"logi",
	"logist",
	"nomi",
	"nomist",
	"pathi",
	"pathet",
	"physicist",
	"scopi",
	"therapeut",
	"therapi",
	"therapist",
	"tomi",
	"tomist",
	"tri",
	"trist",
	"trician",
	"turist"
];
const SPECIAL_WORDS = {
	skis: "ski",
	skies: "sky",
	dying: "die",
	lying: "lie",
	tying: "tie",
	idly: "idl",
	gently: "gentl",
	ugly: "ugli",
	early: "earli",
	only: "onli",
	singly: "singl",
	sky: "sky",
	news: "news",
	howe: "howe",
	atlas: "atlas",
	cosmos: "cosmos",
	bias: "bias",
	andes: "andes",
	inning: "inning",
	innings: "inning",
	outing: "outing",
	outings: "outing",
	canning: "canning",
	cannings: "canning",
	herring: "herring",
	herrings: "herring",
	earring: "earring",
	earrings: "earring",
	proceed: "proceed",
	proceeds: "proceed",
	proceeded: "proceed",
	proceeding: "proceed",
	exceed: "exceed",
	exceeds: "exceed",
	exceeded: "exceed",
	exceeding: "exceed",
	succeed: "success",
	succeeds: "success",
	succeeded: "success",
	succeeding: "success"
};
const MAP_DICT = {
	auto: "car",
	automobil: "car",
	automot: "car"
};
const isVowel = (ch) => VOWELS.includes(ch);
const endsWithAny = (word, suffixes) => suffixes.find((s) => word.endsWith(s));
const startsWithAny = (word, prefixes) => prefixes.some((p) => word.startsWith(p));
function r1r2(word) {
	let r1 = "";
	let r2 = "";
	for (let i = 1; i < word.length; i++) if (!isVowel(word[i]) && isVowel(word[i - 1])) {
		r1 = word.slice(i + 1);
		break;
	}
	for (let i = 1; i < r1.length; i++) if (!isVowel(r1[i]) && isVowel(r1[i - 1])) {
		r2 = r1.slice(i + 1);
		break;
	}
	return [r1, r2];
}
const suffixReplace = (original, old, next) => original.slice(0, -old.length) + next;
function stem(word) {
	if (word in SPECIAL_WORDS) return SPECIAL_WORDS[word];
	if (word.length <= 3) return word;
	if (word.startsWith("y")) word = "Y" + word.slice(1);
	for (let i = 1; i < word.length; i++) if (isVowel(word[i - 1]) && word[i] === "y") word = word.slice(0, i) + "Y" + word.slice(i + 1);
	let r1 = "";
	let r2 = "";
	if (startsWithAny(word, [
		"gener",
		"commun",
		"arsen"
	])) {
		r1 = startsWithAny(word, ["gener", "arsen"]) ? word.slice(5) : word.slice(6);
		for (let i = 1; i < r1.length; i++) if (!isVowel(r1[i]) && isVowel(r1[i - 1])) {
			r2 = r1.slice(i + 1);
			break;
		}
	} else [r1, r2] = r1r2(word);
	{
		const suffix = endsWithAny(word, STEP1A_SUFFIXES);
		if (suffix) {
			if (suffix === "sses") {
				word = word.slice(0, -2);
				r1 = r1.slice(0, -2);
				r2 = r2.slice(0, -2);
			} else if (suffix === "ied" || suffix === "ies") if (word.slice(0, -suffix.length).length > 1) {
				word = word.slice(0, -2);
				r1 = r1.slice(0, -2);
				r2 = r2.slice(0, -2);
			} else {
				word = word.slice(0, -1);
				r1 = r1.slice(0, -1);
				r2 = r2.slice(0, -1);
			}
			else if (suffix === "s") {
				if (word.slice(0, -2).split("").some(isVowel)) {
					word = word.slice(0, -1);
					r1 = r1.slice(0, -1);
					r2 = r2.slice(0, -1);
				}
			}
		}
	}
	{
		const suffix = endsWithAny(word, STEP1B_SUFFIXES);
		if (suffix) {
			if (suffix === "eed" || suffix === "eedly") {
				if (r1.endsWith(suffix)) {
					word = suffixReplace(word, suffix, "ee");
					r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ee") : "";
					r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ee") : "";
				}
			} else if (word.slice(0, -suffix.length).split("").some(isVowel)) {
				word = word.slice(0, -suffix.length);
				r1 = r1.slice(0, -suffix.length);
				r2 = r2.slice(0, -suffix.length);
				if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
					word = word + "e";
					r1 = r1 + "e";
					if (word.length > 5 || r1.length >= 3) r2 = r2 + "e";
				} else if (endsWithAny(word, DOUBLE_CONSONANTS)) {
					word = word.slice(0, -1);
					r1 = r1.slice(0, -1);
					r2 = r2.slice(0, -1);
				} else if (r1 === "" && word.length >= 3 && !isVowel(word[word.length - 1]) && !"wxY".includes(word[word.length - 1]) && isVowel(word[word.length - 2]) && !isVowel(word[word.length - 3]) || r1 === "" && word.length === 2 && isVowel(word[0]) && !isVowel(word[1])) {
					word = word + "e";
					if (r1.length > 0) r1 = r1 + "e";
					if (r2.length > 0) r2 = r2 + "e";
				}
			}
		}
	}
	if (word.length > 2 && "yY".includes(word[word.length - 1]) && !isVowel(word[word.length - 2])) {
		word = word.slice(0, -1) + "i";
		r1 = r1.length >= 1 ? r1.slice(0, -1) + "i" : "";
		r2 = r2.length >= 1 ? r2.slice(0, -1) + "i" : "";
	}
	{
		const suffix = endsWithAny(word, STEP2_SUFFIXES);
		if (suffix && r1.endsWith(suffix)) {
			if (suffix === "entli" || suffix === "fulli" || suffix === "lessli" || suffix === "tional" || suffix === "li" && LI_ENDING.includes(word[word.length - 3])) {
				word = word.slice(0, -2);
				r1 = r1.slice(0, -2);
				r2 = r2.slice(0, -2);
			} else if (suffix === "enci" || suffix === "anci" || suffix === "abli") {
				word = word.slice(0, -1) + "e";
				r1 = r1.length >= 1 ? r1.slice(0, -1) + "e" : "";
				r2 = r2.length >= 1 ? r2.slice(0, -1) + "e" : "";
			} else if (suffix === "izer" || suffix === "ization") {
				word = suffixReplace(word, suffix, "ize");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ize") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ize") : "";
			} else if (suffix === "ational" || suffix === "ation" || suffix === "ator") {
				word = suffixReplace(word, suffix, "ate");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ate") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ate") : "e";
			} else if (suffix === "alism" || suffix === "aliti" || suffix === "alli") {
				word = suffixReplace(word, suffix, "al");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "al") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "al") : "";
			} else if (suffix === "fulness") {
				word = word.slice(0, -4);
				r1 = r1.slice(0, -4);
				r2 = r2.slice(0, -4);
			} else if (suffix === "ousli" || suffix === "ousness") {
				word = suffixReplace(word, suffix, "ous");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ous") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ous") : "";
			} else if (suffix === "iveness" || suffix === "iviti") {
				word = suffixReplace(word, suffix, "ive");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ive") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ive") : "e";
			} else if (suffix === "biliti" || suffix === "bli") {
				word = suffixReplace(word, suffix, "ble");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ble") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ble") : "";
			} else if (suffix === "ogi" && word[word.length - 4] === "l") {
				word = word.slice(0, -1);
				r1 = r1.slice(0, -1);
				r2 = r2.slice(0, -1);
			}
		}
	}
	{
		const suffix = endsWithAny(word, STEP3_SUFFIXES);
		if (suffix && r1.endsWith(suffix)) {
			if (suffix === "tional") {
				word = word.slice(0, -2);
				r1 = r1.slice(0, -2);
				r2 = r2.slice(0, -2);
			} else if (suffix === "ational") {
				word = suffixReplace(word, suffix, "ate");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ate") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ate") : "";
			} else if (suffix === "alize") {
				word = word.slice(0, -3);
				r1 = r1.slice(0, -3);
				r2 = r2.slice(0, -3);
			} else if (suffix === "icate" || suffix === "iciti" || suffix === "ical") {
				word = suffixReplace(word, suffix, "ic");
				r1 = r1.length >= suffix.length ? suffixReplace(r1, suffix, "ic") : "";
				r2 = r2.length >= suffix.length ? suffixReplace(r2, suffix, "ic") : "";
			} else if (suffix === "ful" || suffix === "ness") {
				word = word.slice(0, -suffix.length);
				r1 = r1.slice(0, -suffix.length);
				r2 = r2.slice(0, -suffix.length);
			} else if (suffix === "ative" && r2.endsWith(suffix)) {
				word = word.slice(0, -5);
				r1 = r1.slice(0, -5);
				r2 = r2.slice(0, -5);
			}
		}
	}
	{
		const suffix = endsWithAny(word, STEP4_SUFFIXES);
		if (suffix && r2.endsWith(suffix)) if (suffix === "ion") {
			if ("st".includes(word[word.length - 4])) {
				word = word.slice(0, -3);
				r1 = r1.slice(0, -3);
				r2 = r2.slice(0, -3);
			}
		} else {
			word = word.slice(0, -suffix.length);
			r1 = r1.slice(0, -suffix.length);
			r2 = r2.slice(0, -suffix.length);
		}
	}
	if (r2.endsWith("l") && word[word.length - 2] === "l" || r2.endsWith("e") || r1.endsWith("e") && word.length >= 4 && (isVowel(word[word.length - 2]) || "wxY".includes(word[word.length - 2]) || !isVowel(word[word.length - 3]) || isVowel(word[word.length - 4]))) word = word.slice(0, -1);
	word = word.replace(/Y/g, "y");
	{
		const suffix = endsWithAny(word, STEP6_SUFFIXES);
		if (suffix) {
			if (suffix === "graphi" && word.length >= 9 || suffix === "logi" && word.length >= 7 || suffix === "nomi" && word.length >= 7 || suffix === "pathi" && word.length >= 6 || suffix === "scopi" && word.length >= 8 || suffix === "therapi" || suffix === "tomi" && word.length >= 7 || suffix === "tri" && word.length >= 8 && "ae".includes(word[word.length - 4])) word = word.slice(0, -1);
			else if (suffix === "pathet" && word.length >= 7) word = word.slice(0, -2);
			else if (suffix === "curist" && word.length >= 8 || suffix === "logist" && word.length >= 9 || suffix === "nomist" && word.length >= 9 || suffix === "therapeut" || suffix === "therapist" || suffix === "tomist" && word.length >= 9 || suffix === "trist" && word.length >= 10 && "ae".includes(word[word.length - 6]) || suffix === "turist" && word.length >= 8) word = word.slice(0, -3);
			else if (suffix === "physicist" || suffix === "trician" && word.length >= 10 && "ae".includes(word[word.length - 8])) word = word.slice(0, -5);
		}
	}
	return word;
}
const mapWord = (word) => MAP_DICT[word] ?? word;
function cleanText(text) {
	text = text.toLowerCase();
	text = text.replace(/\bcarrepair\b/g, " car repair ");
	text = text.replace(/\block[ -]+smith/g, " locksmith");
	text = text.replace(/\(except.*\)/g, " ");
	text = text.replace(/[^a-z]+/g, " ");
	text = text.trim();
	text = text.split(" ").filter((w) => w !== "" && !STOP_WORDS.has(w)).join(" ");
	text = text.split(" ").filter((w) => w !== "").map(stem).join(" ");
	text = text.split(" ").filter((w) => w !== "").map(mapWord).join(" ");
	return text;
}
//#endregion
//#region src/naics/beacon-model.ts
/**
* TS port of BeaconModel's fitted-inference path (beacon/beacon.py L823-1100):
* clean_text -> n-combs -> ensemble scoring -> hierarchical conditional
* probability. Ported line-for-line against the Python source for §V6 parity.
*/
function getNcombs(tokens, n) {
	const uniq = [...new Set(tokens)].sort();
	const ncombs = [];
	if (n === 1 && uniq.length >= 1 && uniq[0] !== "") ncombs.push(...uniq);
	else if (n === 2 && uniq.length >= 2) for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) ncombs.push(`${uniq[i]}_${uniq[j]}`);
	else if (n === 3 && uniq.length >= 3) for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) for (let k = j + 1; k < uniq.length; k++) ncombs.push(`${uniq[i]}_${uniq[j]}_${uniq[k]}`);
	return ncombs;
}
function isProperSubset(a, b) {
	if (a.size >= b.size) return false;
	for (const x of a) if (!b.has(x)) return false;
	return true;
}
function getFeatsUmb(nc1s, nc2s, nc3s) {
	const nc2Sets = nc2s.map((nc) => new Set(nc.split("_")));
	const nc3Sets = nc3s.map((nc) => new Set(nc.split("_")));
	const nc1sUmb = nc1s.filter((nc1) => nc2Sets.every((s) => !isProperSubset(/* @__PURE__ */ new Set([nc1]), s)));
	const nc2sUmb = nc2s.filter((_, i) => nc3Sets.every((s) => !isProperSubset(nc2Sets[i], s)));
	return [
		...nc1sUmb,
		...nc2sUmb,
		...nc3s
	];
}
function normScores(scoresRaw) {
	const total = Object.values(scoresRaw).reduce((a, b) => a + b, 0);
	if (total <= 0) return scoresRaw;
	const out = {};
	for (const naics in scoresRaw) out[naics] = scoresRaw[naics] / total;
	return out;
}
/** TS port of BEACON's fitted-inference path — predicts NAICS codes from free text. */
var BeaconModel = class {
	params;
	/** @param params Fitted model params, e.g. from `loadNaics()`. */
	constructor(params) {
		this.params = params;
	}
	calcScoresNonexact(feats, sector) {
		const { sector_naics, dict_ncombs_weights, dict_ncombs_props } = this.params;
		const scores = {};
		for (const naics of sector_naics[sector]) scores[naics] = 0;
		for (const nc of feats) {
			const weight = dict_ncombs_weights[sector][nc];
			const props = dict_ncombs_props[sector][nc];
			for (const naics in props) scores[naics] += weight * props[naics];
		}
		return normScores(scores);
	}
	calcScoresExact(feats, xExact, sector) {
		const { sector_naics, dict_ems_weights, dict_ems_props } = this.params;
		const scores = {};
		for (const naics of sector_naics[sector]) scores[naics] = 0;
		if (xExact in dict_ems_weights[sector]) {
			const props = dict_ems_props[sector][xExact];
			for (const naics in props) scores[naics] = props[naics];
		} else for (const em of feats) if (em in dict_ems_weights[sector]) {
			const weight = dict_ems_weights[sector][em];
			const props = dict_ems_props[sector][em];
			for (const naics in props) scores[naics] += weight * props[naics];
		}
		return normScores(scores);
	}
	calcScoresEnsemble(tokens, sector) {
		const props = this.params.dict_ncombs_props[sector];
		const nc1s = getNcombs(tokens, 1).filter((nc) => nc in props);
		const nc2s = getNcombs(tokens, 2).filter((nc) => nc in props);
		const nc3s = getNcombs(tokens, 3).filter((nc) => nc in props);
		const xExact = [...new Set(nc1s)].sort().join("_");
		const featsStand = [
			...nc1s,
			...nc2s,
			...nc3s
		];
		const featsUmb = getFeatsUmb(nc1s, nc2s, nc3s);
		const scoresStand = this.calcScoresNonexact(featsStand, sector);
		const scoresUmb = this.calcScoresNonexact(featsUmb, sector);
		const scoresExact = this.calcScoresExact(featsStand, xExact, sector);
		const { wt_umb, wt_exact } = this.params;
		const scoresEnsemble = {};
		for (const naics in scoresStand) scoresEnsemble[naics] = (1 - wt_umb - wt_exact) * scoresStand[naics] + wt_umb * scoresUmb[naics] + wt_exact * scoresExact[naics];
		return normScores(scoresEnsemble);
	}
	calcScoresHier(x) {
		const tokens = cleanText(x).split(" ");
		const scoresDict = {};
		scoresDict["00"] = this.calcScoresEnsemble(tokens, "00");
		for (const sector of this.params.sectors) scoresDict[sector] = scoresDict["00"][sector] > 0 ? this.calcScoresEnsemble(tokens, sector) : Object.fromEntries(this.params.sector_naics[sector].map((n) => [n, 0]));
		const scoresHier = {};
		for (const sector of this.params.sectors) for (const naics in scoresDict[sector]) scoresHier[naics] = scoresDict["00"][sector] * scoresDict[sector][naics];
		return normScores(scoresHier);
	}
	/** Full score distribution over all 6-digit NAICS codes, matching predict_proba(). */
	predictProba(text) {
		return this.calcScoresHier(text);
	}
	/** Top-N codes with positive score, descending. */
	predictTopN(text, n = 10) {
		const scores = this.predictProba(text);
		return Object.entries(scores).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([naics, score]) => ({
			naics,
			score
		}));
	}
};
//#endregion

// ---- Coverdash everyday terms ------------------------------------------------
// Phrases AEs and customers actually say, mapped to the class we usually quote them under.
const SYNONYMS = {
  '238220': 'plumber; plumbing; hvac; heating and cooling; air conditioning; ac repair; ac install; furnace; water heater; leaky pipes; drain cleaning; boiler',
  '238210': 'electrician; electrical contractor; wiring; solar install; solar panel installation; ev charger install; low voltage; lighting install',
  '236118': 'handyman; remodeling; remodeler; renovation; kitchen remodel; bathroom remodel; home improvement; home repair; general contractor residential',
  '236115': 'home builder; custom homes; build houses; new home construction; general contractor new homes',
  '236220': 'commercial contractor; commercial construction; tenant improvement; general contractor commercial',
  '238160': 'roofer; roofing; roof repair; roof replacement; shingles',
  '238320': 'painter; painting contractor; house painter; interior painting; exterior painting; wallpaper',
  '238350': 'carpenter; carpentry; trim carpentry; finish carpentry; cabinet install; door install; deck builder',
  '238330': 'flooring; floor installer; tile installer; hardwood floors; carpet installer; vinyl plank',
  '238310': 'drywall; insulation; sheetrock; plaster',
  '238140': 'mason; masonry; bricklayer; stone work; stucco',
  '238110': 'concrete; concrete contractor; foundation; flatwork; driveway paving',
  '238990': 'fence; fencing; fence installation; paving; asphalt; sealcoating; driveway; pool installation; epoxy floors',
  '238910': 'excavation; excavating; grading; site prep; demolition; land clearing; dirt work',
  '238170': 'siding; siding install; gutters; gutter install',
  '238290': 'garage door; elevator; fire sprinkler; security system install',
  '238190': 'welding contractor; structural welding; foundation repair; waterproofing',
  '561720': 'cleaning; house cleaning; maid service; cleaning service; janitorial; office cleaning; commercial cleaning; residential cleaning; move out cleaning',
  '561730': 'landscaping; landscaper; lawn care; lawn mowing; yard work; tree service; tree trimming; tree removal; snow removal; irrigation',
  '561790': 'pressure washing; power washing; window cleaning; gutter cleaning; pool cleaning; pool service; chimney sweep; duct cleaning',
  '561740': 'carpet cleaning; upholstery cleaning; rug cleaning',
  '561710': 'pest control; exterminator; termite; bug spraying',
  '562111': 'junk removal; trash hauling; waste collection; dumpster',
  '484110': 'trucking; local trucking; hauling; box truck; freight',
  '484121': 'long haul trucking; over the road trucking; owner operator; semi truck; cdl',
  '484210': 'movers; moving company; moving service; relocation',
  '492110': 'courier; delivery service; last mile delivery; delivery driver',
  '454110': 'online store; ecommerce; e-commerce; sells online; online seller; amazon seller; shopify; etsy; dropshipping; online retail; website sales',
  '511210': 'saas; software company; software product; app company; mobile app',
  '541511': 'software developer; web developer; website design; web design; app developer; programming; coding',
  '541512': 'information technology services; information technology consulting; managed services; msp; tech support; network setup; cybersecurity consulting',
  '541611': 'business consultant; management consulting; consultant; consulting firm; operations consulting',
  '541613': 'marketing consultant; social media marketing; seo; digital marketing',
  '541810': 'marketing agency; advertising agency; ad agency; creative agency',
  '541430': 'graphic designer; graphic design; logo design; branding',
  '541921': 'photographer; photography; portrait photographer; wedding photographer',
  '711510': 'artist; writer; freelance writer; content creator; influencer; musician; author; dj; disc jockey; wedding dj; band',
  '512110': 'videographer; video production; film production',
  '531210': 'real estate agent; realtor; real estate broker',
  '531311': 'property manager; property management',
  '531110': 'landlord; rental property; airbnb host; short term rental',
  '722511': 'restaurant; sit down restaurant; bar and grill; diner',
  '722513': 'fast food; takeout; pizza shop; sandwich shop; quick service restaurant',
  '722330': 'food truck; food cart; mobile food; concession trailer',
  '722515': 'coffee shop; cafe; juice bar; smoothie shop; ice cream shop; boba',
  '722320': 'catering; caterer; event catering',
  '311811': 'bakery; baker; cupcakes; cakes',
  '561920': 'event planner; event planning; wedding planner; trade show',
  '812112': 'hair salon; hair stylist; beauty salon; salon; cosmetologist; lash extensions; makeup artist',
  '812111': 'barber; barbershop',
  '812113': 'nail salon; nail tech; manicure',
  '812199': 'tattoo; tattoo shop; spa; massage; waxing; tanning; esthetician',
  '812910': 'dog grooming; pet grooming; dog walking; dog walker; pet sitting; dog training; boarding kennel',
  '713940': 'gym; fitness center; personal trainer; yoga studio; pilates; crossfit; martial arts',
  '611620': 'sports instruction; swim lessons; golf instructor; coach; sports camp',
  '624410': 'daycare; day care; childcare; child care; preschool; nanny agency',
  '621610': 'home health; home care; caregiver; home health aide',
  '624120': 'senior care; elder care; companion care; disability services',
  '621111': 'doctor; physician; medical practice; clinic',
  '621210': 'dentist; dental office; orthodontist',
  '621340': 'physical therapist; occupational therapy; speech therapy',
  '621399': 'chiropractor; acupuncture; nutritionist; med spa',
  '541211': 'cpa; accountant; accounting firm; tax preparer',
  '541219': 'bookkeeping; bookkeeper; tax preparation',
  '541110': 'lawyer; attorney; law firm; legal services',
  '524210': 'insurance agent; insurance agency; insurance broker',
  '541330': 'engineer; engineering firm; civil engineer; structural engineer',
  '541310': 'architect; architecture firm',
  '811111': 'auto repair; mechanic; auto shop; car repair; oil change; mobile mechanic',
  '811121': 'auto body; collision repair; auto paint; detailing',
  '811192': 'car wash; car detailing; mobile detailing',
  '811310': 'equipment repair; machinery repair; small engine repair',
  '812990': 'personal assistant; concierge; errand service',
  '532289': 'bounce house; party rentals; tent rental; event rentals; equipment rental',
  '541922': 'drone photography; commercial photographer; product photography',
  '541690': 'environmental consultant; safety consultant; technical consulting',
  '541618': 'consultant; strategy consulting; business coach',
  '541612': 'hr consultant; human resources consulting',
  '453998': 'retail store; gift shop; smoke shop; vape shop; boutique',
  '448190': 'clothing store; apparel store; t-shirt printing',
  '325620': 'cosmetics; skincare products; beauty products; soap making; candle making',
  '339999': 'manufacturer; product manufacturing; 3d printing',
};

// ---- Hybrid search -------------------------------------------------------------
const NaicsSearch = {
  model: null, loading: null, index: null,
  load(url) {
    if (!this.loading) this.loading = fetch(url).then(r => r.json()).then(p => { this.model = new BeaconModel(p); return this.model; }).catch(() => null);
    return this.loading;
  },
  build(naicsList) {
    // naicsList: [[code, title, count], ...]
    const max = Math.max(1, ...naicsList.map(n => n[2]));
    this.index = naicsList.map(([code, title, count]) => {
      const syn = (SYNONYMS[code] || '').split(';').map(s => s.trim()).filter(Boolean);
      const words = new Set(cleanText(title + ' ' + syn.join(' ')).split(' ').filter(Boolean));
      const phrases = syn.map(s => cleanText(s).split(' ').filter(Boolean)).filter(a => a.length);
      return { code, title, count, words, phrases, pop: Math.log1p(count) / Math.log1p(max) };
    });
    this.byCode = new Map(this.index.map(e => [e.code, e]));
  },
  search(query, limit = 8) {
    // "IT" would otherwise be dropped as a stop word
    const q = query.trim().replace(/\bIT\b/g, 'information technology')
      .replace(/\bit (consult|servic|support|compan|firm|manag|tech)/gi, 'information technology $1');
    if (!q) return this.index.filter(e => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 40).map(e => ({ ...e, score: 0 }));
    if (/^\d{2,6}$/.test(q)) return this.index.filter(e => e.code.startsWith(q)).sort((a, b) => b.count - a.count).slice(0, 40).map(e => ({ ...e, score: 1 }));
    const stems = [...new Set(cleanText(q).split(' ').filter(Boolean))];
    if (!stems.length) return [];
    const qset = new Set(stems);
    // 1. BEACON probabilities, rescaled so the top class = 1
    let beacon = {};
    if (this.model) {
      const top = this.model.predictTopN(q, 25);
      if (top.length) { const m = top[0].score; for (const t of top) beacon[t.naics] = t.score / m; }
    }
    const out = [];
    for (const e of this.index) {
      // 2. text match: share of query words found in title/synonyms; a full synonym phrase counts as a perfect hit
      let hit = 0; for (const s of stems) if (e.words.has(s)) hit++;
      let t = hit / stems.length;
      let phrase = 0;
      for (const ph of e.phrases) if (ph.every(w => qset.has(w))) { t = Math.max(t, ph.length > 1 ? 1 : 0.85); phrase = Math.max(phrase, ph.length > 1 ? 0.25 : 0.1); }
      const b = beacon[e.code] || 0;
      if (!t && !b) continue;
      // 3. popularity nudge for classes we quote a lot
      const score = 0.45 * b + 0.55 * t + phrase + 0.12 * e.pop;
      out.push({ ...e, score, b, t });
    }
    out.sort((a, b) => b.score - a.score);
    const best = out.length ? out[0].score : 0;
    return out.filter(e => e.score >= best * 0.4).slice(0, limit);
  },
};
root.NaicsSearch = NaicsSearch;
if (typeof module === 'object' && module.exports) module.exports = { NaicsSearch, BeaconModel, cleanText };

})(this);
