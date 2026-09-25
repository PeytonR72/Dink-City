// Plain-language Fault banner text for every way a Rally can end.
import type { DeadReason } from '../sim';

export interface FaultText {
  title: string;
  detail: string;
  /** Pop the title in word by word, then type the detail out. */
  emphasis?: true;
}

interface Words {
  /** "You" / "They" */
  who: string;
  /** "Your" / "Their" */
  whose: string;
}

const TEXT: Record<DeadReason, (w: Words) => FaultText> = {
  out: (w) => ({ title: 'OUT', detail: `${w.whose} shot landed outside the court.` }),
  // A running joke, so it's the same line whoever hit the net.
  net: () => ({ title: 'NET CITY', detail: 'The ball actually needs to go OVER the net.', emphasis: true }),
  'double-bounce': (w) => ({ title: 'POINT', detail: `${w.who} let the ball bounce twice.` }),
  'service-kitchen': (w) => ({ title: 'SERVICE FAULT', detail: `${w.whose} serve landed in the kitchen.` }),
  'service-court': (w) => ({
    title: 'SERVICE FAULT',
    detail: `${w.whose} serve has to land in the diagonal service court.`,
  }),
  'two-bounce': (w) => ({
    title: 'TWO-BOUNCE FAULT',
    detail: `${w.who} volleyed too early. The serve and the return must both bounce first.`,
  }),
  kitchen: (w) => ({ title: 'KITCHEN FAULT', detail: `${w.who} volleyed while standing in the kitchen.` }),
};

/** Banner text for a Rally ending, told from the local Player's point of view. */
export function faultText(reason: DeadReason, localLost: boolean): FaultText {
  return TEXT[reason](localLost ? { who: 'You', whose: 'Your' } : { who: 'They', whose: 'Their' });
}
