
export type KenoGameState = 'betting' | 'draw' | 'result';

export interface KenoTicket {
  numbers: number[];
  betAmount: number;
  id: string;
  timestamp: number;
}

export interface KenoRound {
  id: string;
  drawNumbers: number[];
  hotNumbers: number[];
  coldNumbers: number[];
  serverSeedHash: string;
  timestamp: number;
}
