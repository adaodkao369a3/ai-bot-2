/**
 * Nickname word banks for Bocchi's nickname generator
 * Simple random combinations for stupid Discord-style nicknames
 */

export const FIRST_WORDS = [
  // titles
  "cap",
  "chief",
  "sir",
  "lord",
  "king",
  "queen",
  "dr",
  "prof",
  "mr",
  "miss",
  "boss",
  "doc",
  "coach",
  "unc",

  // size / status
  "big",
  "lil",
  "tiny",
  "fat",
  "skinny",
  "mini",
  "mega",
  "micro",
  "old",
  "young",
  "poor",
  "rich",
  "mid",

  // personality
  "dumb",
  "stupid",
  "silly",
  "lazy",
  "crazy",
  "weird",
  "feral",
  "goofy",
  "clueless",
  "hopeless",
  "cum",
  "sleepy",
  "angry",
  "lonely",
  "broke",
  "salty",
  "toxic",
  "chill",
  "sweaty",

  // internet
  "anal",
  "bro",
  "blud",
  "dawg",
  "gang",
  "sigma",
  "chad",
  "aura",
  "mog",
  "based",
  "sus",
  "cringe",
  "ratio",
  "valid",
  "fake",
  "real",
  "pocket",
  "local",

  // cursed
  "balls",
  "rat",
  "goblin",
  "demon",
  "god",
  "loser",
  "menace",
  "threat",
  "victim",
  "opp",
  "hater",

  // funny descriptors
  "certified",
  "pro",
  "amateur",
  "professional",
  "retired",
  "unemployed",
  "expired",
  "cursed",
  "blessed",
  "forbidden",
  "illegal",
  "dangerous",
  "harmless",
  "hot",
  "horny",
  "single",
  "virgin",
  "sussy",
];

export const SECOND_WORDS = [
  // people / roles
  
  "nurse",
  
  "bossman",
  
  "dealer",

  // stupid creatures
  

  // internet shit
  "npc",
  "yapper",
  "gooner",
  "simp",
  "cum",
  "virgin",
  "noob",
  "fanboy",
  "hater",
  "dumpster",
  "lurker",
  "troll",
  "spammer",
  "bag",

  // objects / concepts
  
  "fridge",
  
  "mic",
  
  "stick",

  // disasters
  "failure",
  "mistake",
  "sock",
  "disaster",
  "accident",
  "burden",
  "bong",
  "threat",
  "victim",
  "suspect",
  "witness",
  "patient",
  "incident",
  "menace",
  "opponent",
  "gyat",

  // names that make combos stupid
  
  "peenar",

  // anime
  "zenin",
  "joestar",
  "toji",
  "plug",
  "dildo",

  // completely random
  "balls",
  "dih",
  "ahh",
  "vagina",
  "mommy",
  "daddy",
  "shitter",
  "tit",
  "beads",
  "titties",
  "pussy",
  "pocket",

  
   "clit", 
  "butthole", 
  "jizz", 
  "cum", 
  "fart", 
  "poop", 
  "pee", 
  "boobs", 
  "nipples", 
  "dong", 
  "schlong", 
  "pecker", 
  "weiner", 
  "penis", 
  "vag", 
  "butt", 
  "booty", 
  "asshole",
  "sock", 
  "panties", 
  "bra", 
];

// Discord nickname length limit is 32 characters
export const DISCORD_NICKNAME_MAX_LENGTH = 32;

// Maximum number of generation attempts before giving up
export const NICKNAME_MAX_GENERATION_ATTEMPTS = 50;

// Owner role ID - members with this role are excluded from all automatic nickname operations
export const OWNER_ROLE_ID = "1535285079658598460";
