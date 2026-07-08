declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        close: () => void;
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
            photo_url?: string;
          };
        };
        openTelegramLink: (url: string) => void;
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        };
      };
    };
  }
}

export type Side = "even" | "odd";

export interface PlayerBet {
  userId: string;
  username: string;
  amount: number;
  side: Side;
  partial: boolean;
}

export interface BingoRoomState {
  id: string;
  roundId: string;
  status: "lobby" | "playing" | "result";
  timeLeft: number;
  players: Record<string, { userId: string; username: string; cards: number[]; photoUrl?: string }>;
  calledBalls: number[];
  currentBall?: number;
  winners: Array<{ userId: string; username: string; type: string; winAmount: number; cardId?: number; cards?: number[] }>;
  onlineCount: number;
  betAmount: number;
  jackpot?: number;
  gameId: string;
}

export interface RoomState {
  id: string;
  roundId: number;
  status: "betting" | "balancing" | "spinning" | "result";
  timeLeft: number;
  players: Record<string, PlayerBet>;
  pools: { even: number; odd: number };
  feed: string[];
  history: { roundId: number; winner: number; pools: { even: number; odd: number } }[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
  onlineCount?: number;
}
