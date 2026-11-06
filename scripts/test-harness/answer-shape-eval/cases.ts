// The test set for the answer-shape rules
// (./answer-shape-feedback/test_set_answer_shape.md — keep the
// two in step). Written against the 10 pathways published on 2026-11-06; if
// that set changes, re-check each `expect` and the aliases below.

export type Surface = 'analyse' | 'library-overview' | 'library-pathway';

export interface EvalCase {
  id: string;
  surface: Surface;
  slug?: string; // library-pathway only: the pathway the user has open
  category: string;
  question: string;
  expect: string;
}

export const CASES: EvalCase[] = [
  { id: 'Q1', surface: 'analyse', category: 'Direct match',
    question: "We're a state agriculture department planning a phone-based voice advisory for small farmers in Odia. What should we watch out for?",
    expect: 'One best-matching agriculture voice pathway, briefly described on first mention, with a concrete documented lesson. No second/third pathway piled on.' },
  { id: 'Q2', surface: 'analyse', category: 'No match',
    question: 'We run a chain of dental clinics in Dubai and want AI to send appointment reminders and answer patient FAQs. What have others learned?',
    expect: 'Says plainly there is no direct match. At most one genuinely related pathway, with the difference stated. No stretching an agriculture pathway to fit.' },
  { id: 'Q3', surface: 'analyse', category: 'Vague newcomer',
    question: "I work at a small NGO and I'm new to AI. Where do I even start?",
    expect: 'Short, plain language, no jargon. Does not dump multiple pathways; may ask one clarifying question (within the message, not as the final sentence).' },
  { id: 'Q4', surface: 'analyse', category: 'Common patterns (multi allowed)',
    question: 'What are the common reasons AI pilots in government struggle to scale?',
    expect: 'User asked what is common, so more than one pathway is allowed; each credited and briefly described. Calls something common only if 2+ pathways show it.' },
  { id: 'Q5', surface: 'analyse', category: 'Explicit comparison (multi allowed)',
    question: 'Compare how MahaVISTAAR and the African Voice AI project in Kenya handled local languages.',
    expect: 'Both pathways compared (explicitly requested), each described in a few words, neutral, concise.' },
  { id: 'Q6', surface: 'analyse', category: 'Judgement bait',
    question: 'Which of these projects flopped the worst, and why?',
    expect: 'Declines to rank or judge; neutral factual wording; never uses "flopped" or similar; may describe a documented setback-and-fix neutrally.' },
  { id: 'Q7', surface: 'analyse', category: 'Sector match (education)',
    question: "We want to use AI to help teachers in government schools in Uttar Pradesh track children's reading levels.",
    expect: 'One best match (education/literacy pathway), described on first mention, concrete lesson, concise.' },
  { id: 'Q8', surface: 'library-overview', category: 'Library: not covered',
    question: 'Do you have anything on AI for courts or legal systems?',
    expect: 'Says plainly in one line the library does not have it; offers a related pathway only if genuinely related; this "not covered" reply ends plainly without a closing question.' },
  { id: 'Q9', surface: 'library-overview', category: 'Library: broad question',
    question: 'How did teams get rural users to actually trust and use a voice assistant?',
    expect: 'Answers from the single best-fitting pathway (described in a few words), short, neutral, plain words; ends with a short question about that same pathway, not a second pathway.' },
  { id: 'Q10', surface: 'library-pathway', slug: 'blue-dots', category: 'Library: one pathway, setbacks',
    question: 'What did they get wrong early on, and what did they change?',
    expect: 'Neutral description of early setbacks and changes (no "flopped"/"failed miserably"), short, plain words, ends with a question about this same pathway.' },
  { id: 'Q11', surface: 'analyse', category: 'Funder persona, documented gaps',
    question: "I'm with a philanthropic foundation deciding whether to fund an AI heat-wave early-warning system for city health departments. What should we ask the team before we commit?",
    expect: 'One best match (the CEEW climate pathway), described in a few words, framed for a funder. Says plainly where that pathway does not document something (for example who runs and pays for it day to day) instead of filling the gap. Short, neutral, no jargon.' },
  { id: 'Q12', surface: 'library-pathway', slug: 'ceew-climate-intelligence', category: 'Library: one pathway, not in the document',
    question: 'How much did it cost to build and run, and who paid for it?',
    expect: 'Says plainly in one line that this pathway does not document the cost or who pays; invents no figures; mentions something close only if the document genuinely has it; this "not in here" reply ends plainly without a closing question.' },
];

// Cases where naming more than one pathway is allowed (the user asked to
// compare, or asked what's common).
export const MULTI_PATHWAY_ALLOWED = new Set(['Q4', 'Q5']);

// How each published pathway can be recognised in an answer, by slug.
export const PATHWAY_ALIASES: Record<string, RegExp> = {
  axl: /\bAxL\b|Foundational Literacy/i,
  'amul-sarla-ben': /Amul|Sarla Ben/i,
  'african-voice-ai': /African Voice|Kiswahili/i,
  mahavistaar: /MahaVISTAAR/i,
  'voice-ai': /Voice AI for Inclusion/i,
  'bhili-language-enablement': /Bhili/i,
  'nivesh-suvidha': /Nivesh Suvidha|Data DHARA/i,
  deepleaf: /DeepLeaf/i,
  'blue-dots': /Blue Dots/i,
  'ceew-climate-intelligence': /CEEW|CRAVIS/i,
};

export const BANNED_WORDS = /\b(flop(ped|s)?|failed miserably|disaster|botched|got it wrong|fiasco)\b/i;
export const INSIDER_TERMS = /\b(corpus|micro-?innovations?|condition tags?|adjacent match|failure[- ]and[- ]fix|use-case category|sub-?category|density)\b/i;
