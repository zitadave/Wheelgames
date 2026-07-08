import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target1 = '''  const [activeWinnerIdx, setActiveWinnerIdx] = useState<number>(0);'''
replacement1 = '''  const [activeWinnerIdx, setActiveWinnerIdx] = useState<number>(0);

  const allSelectedCards = useMemo(() => {
    const cards = new Set<number>();
    if (roomState?.players) {
      Object.values(roomState.players).forEach((p: any) => {
        if (p.userId !== userId) {
          p.cards?.forEach((c: number) => cards.add(c));
        }
      });
    }
    return cards;
  }, [roomState?.players, userId]);'''
code = code.replace(target1, replacement1)

target2 = '''              {Array.from({ length: 400 }, (_, i) => i + 1).map(id => (
                <button
                  key={id}
                  onClick={() => toggleCard(id)}
                  className={`h-9 rounded-md font-black text-[10px] transition-all active:scale-90 border flex items-center justify-center shadow-sm ${
                    selectedCards.includes(id)
                      ? 'bg-green-500 border-green-400 text-[#121421] shadow-green-500/30 scale-105 z-10'
                      : 'bg-[#1a1c2e] border-gray-800/50 text-gray-400 hover:border-gray-600 hover:bg-[#252841]'
                  }`}
                >
                  {id}
                </button>
              ))}'''

replacement2 = '''              {Array.from({ length: 400 }, (_, i) => i + 1).map(id => {
                const isTaken = allSelectedCards.has(id);
                const isSelectedByMe = selectedCards.includes(id);
                return (
                  <button
                    key={id}
                    disabled={isTaken && !isSelectedByMe}
                    onClick={() => {
                      if (!isTaken || isSelectedByMe) {
                        toggleCard(id);
                      }
                    }}
                    className={`h-9 rounded-md font-black text-[10px] transition-all border flex items-center justify-center shadow-sm ${
                      isSelectedByMe
                        ? 'bg-green-500 border-green-400 text-[#121421] shadow-green-500/30 scale-105 z-10 active:scale-90 cursor-pointer'
                        : isTaken
                        ? 'bg-red-500/10 border-red-500/30 text-red-500/50 cursor-not-allowed overflow-hidden relative'
                        : 'bg-[#1a1c2e] border-gray-800/50 text-gray-400 hover:border-gray-600 hover:bg-[#252841] active:scale-90 cursor-pointer'
                    }`}
                  >
                    {isTaken && !isSelectedByMe && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-30">
                        <div className="w-full h-px bg-red-500 rotate-45 absolute" />
                        <div className="w-full h-px bg-red-500 -rotate-45 absolute" />
                      </div>
                    )}
                    <span className={isTaken && !isSelectedByMe ? 'opacity-30' : ''}>{id}</span>
                  </button>
                );
              })}'''
code = code.replace(target2, replacement2)

with open('src/components/BingoGame.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')
