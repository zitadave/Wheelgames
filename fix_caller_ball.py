import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target1 = '''            {/* Right: Caller Ball + 3 Preceding Called Numbers (Horizontal layout) */}
            <div className="flex items-center gap-2 justify-end">
              {/* Dynamic Caller Ball (Latest) - Larger */}
              {roomState.calledBalls.length > 0 ? (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-600 flex items-center justify-center shadow-[0_0_10px_rgba(249,115,22,0.7)] border border-white/25 select-none shrink-0 animate-pulse">
                  <span className="text-[13px] font-black text-purple-950 font-mono leading-none tracking-tighter">
                    {(() => {
                      const lastBall = roomState.calledBalls[roomState.calledBalls.length - 1];
                      const letter = lastBall <= 15 ? 'B' : lastBall <= 30 ? 'I' : lastBall <= 45 ? 'N' : lastBall <= 60 ? 'G' : 'O';
                      return `${letter}-${lastBall}`;
                    })()}
                  </span>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <span className="text-[13px] font-black text-gray-500 font-mono leading-none">--</span>
                </div>
              )}

              {/* 3 Preceding Called Numbers (horizontal layout, larger size) */}
              <div className="flex items-center gap-1 select-none shrink-0">
                {(roomState.calledBalls.length > 1 
                  ? roomState.calledBalls.slice(0, -1).slice(-3).reverse() 
                  : []
                ).map((ball, i) => ('''

replacement1 = '''            {/* Right: Caller Ball + 4 Preceding Called Numbers (Horizontal layout) */}
            <div className="flex items-center gap-2 justify-end">
              {/* Dynamic Caller Ball (Latest) - Larger */}
              {roomState.calledBalls.length > 0 ? (
                <motion.div 
                  key={`caller-ball-${roomState.calledBalls[roomState.calledBalls.length - 1]}`}
                  initial={{ scale: 0.2, rotate: -180, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-600 flex items-center justify-center shadow-[0_0_10px_rgba(249,115,22,0.7)] border border-white/25 select-none shrink-0"
                >
                  <span className="text-[13px] font-black text-purple-950 font-mono leading-none tracking-tighter">
                    {(() => {
                      const lastBall = roomState.calledBalls[roomState.calledBalls.length - 1];
                      const letter = lastBall <= 15 ? 'B' : lastBall <= 30 ? 'I' : lastBall <= 45 ? 'N' : lastBall <= 60 ? 'G' : 'O';
                      return `${letter}-${lastBall}`;
                    })()}
                  </span>
                </motion.div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <span className="text-[13px] font-black text-gray-500 font-mono leading-none">--</span>
                </div>
              )}

              {/* 4 Preceding Called Numbers (horizontal layout, larger size) */}
              <div className="flex items-center gap-1 select-none shrink-0">
                {(roomState.calledBalls.length > 1 
                  ? roomState.calledBalls.slice(0, -1).slice(-4).reverse() 
                  : []
                ).map((ball, i) => ('''

if target1 in code:
    code = code.replace(target1, replacement1)
    with open('src/components/BingoGame.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
