const fs = require('fs');
const content = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

const target = `            if (item) {
              return (
                <motion.div
                  key={num}
                  onClick={() => handleClaimSlot(num)}
                  whileTap={{ scale: 0.95 }}
                  className={\`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 cursor-pointer transition-all relative overflow-hidden \${
                    isWinner 
                      ? 'bg-gradient-to-b from-green-500 to-green-600 border-green-400 text-white shadow-lg scale-105 z-10'
                      : isBlitzActive
                      ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                      : item.isSelf
                      ? 'bg-gradient-to-br from-yellow-400 via-amber-500 to-yellow-600 border-yellow-300 text-black shadow-[0_0_20px_rgba(245,158,11,0.6)] ring-2 ring-yellow-400 scale-110 z-30 font-black'
                      : 'bg-gray-100 dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-600 grayscale opacity-80'
                  }\`}
                  style={isBlitzActive ? { opacity: 1 } : undefined}
                >
                  {item.photoUrl && !isBlitzActive && !isWinner && !item.isSelf ? (
                     <div className="absolute inset-0 opacity-20 pointer-events-none">
                       <img src={item.photoUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                     </div>
                  ) : null}
                  
                  <span className={\`text-[10px] font-black font-mono leading-none z-10 \${item.isSelf ? 'text-black' : ''}\`}>{num}</span>
                  <div className={\`flex items-center gap-0.5 text-[6px] font-semibold tracking-tighter mt-0.5 truncate max-w-full leading-none z-10 \${item.isSelf ? 'text-black' : ''}\`}>
                    {item.isSelf ? (
                      <Crown className="w-1.5 h-1.5 shrink-0 text-black" />
                    ) : item.photoUrl ? (
                      <img src={item.photoUrl} alt="Avatar" className="w-2 h-2 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <Lock className="w-1.5 h-1.5 shrink-0" />
                    )}
                    <span className="truncate max-w-[24px]">{item.isSelf ? 'YOU' : item.username}</span>
                  </div>
                </motion.div>
              );
            }
            return (
              <motion.button
                key={num}
                onClick={() => handleClaimSlot(num)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={\`aspect-square rounded-lg bg-white dark:bg-gray-800/50 border-2 border-blue-500/30 dark:border-blue-400/20 flex flex-col items-center justify-center p-0.5 shadow-sm hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all \${
                  isBlitzActive
                    ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                    : ''
                }\`}
                style={isBlitzActive ? { opacity: 1 } : undefined}
              >
                <span className="text-[11px] font-black font-mono text-gray-900 dark:text-gray-100 leading-none">{num}</span>
                <div className="flex items-center gap-0.5 mt-0.5">
                  <span className="text-[7px] font-black text-blue-600 dark:text-blue-400 tracking-tighter">2K</span>
                  <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                </div>
              </motion.button>
            );`;

const replacement = `            if (item) {
              return (
                <motion.div
                  key={num}
                  onClick={() => handleClaimSlot(num)}
                  whileTap={{ scale: 0.95 }}
                  className={\`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 cursor-pointer transition-all relative overflow-hidden \${
                    isWinner 
                      ? 'bg-gradient-to-b from-green-500 to-green-600 border-green-400 text-white shadow-lg scale-105 z-10'
                      : item.isSelf
                      ? 'bg-blue-500 dark:bg-[#4a85f6] border-blue-400 dark:border-[#5b8bf7] text-white shadow-sm scale-110 z-30'
                      : 'bg-transparent border-transparent text-gray-500 opacity-60'
                  }\`}
                >
                  <span className={\`text-[11px] font-black font-mono leading-none z-10 \${item.isSelf ? 'text-white' : 'text-gray-500'}\`}>{num}</span>
                  <div className={\`flex items-center justify-center mt-0.5 z-10 \${item.isSelf ? '' : 'opacity-60'}\`}>
                    {item.isSelf ? (
                      <div className="flex items-center gap-0.5 bg-blue-600/20 px-0.5 py-0.5 rounded">
                        <div className="w-2 h-2 rounded-full bg-[#87e1e1] flex items-center justify-center shrink-0">
                          <span className="text-[5px] font-black text-blue-900 leading-none">{item.username ? item.username.charAt(0).toUpperCase() : 'D'}</span>
                        </div>
                        <span className="text-[6px] font-black text-white leading-none tracking-tighter">You</span>
                      </div>
                    ) : (
                      <Lock className="w-2 h-2 shrink-0 text-gray-500" />
                    )}
                  </div>
                </motion.div>
              );
            }
            return (
              <motion.button
                key={num}
                onClick={() => handleClaimSlot(num)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="aspect-square rounded-lg bg-gray-50 dark:bg-[#161b28] border border-gray-200 dark:border-[#232a3b] flex flex-col items-center justify-center p-0.5 shadow-sm hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-[#1c2438] transition-all"
              >
                <span className="text-[11px] font-black font-mono text-gray-800 dark:text-white leading-none">{num}</span>
                <div className="flex items-center mt-0.5">
                  <span className="text-[8px] font-black text-blue-500 dark:text-[#4da1f7] tracking-tighter">2K</span>
                </div>
              </motion.button>
            );`;

if (content.includes(target)) {
  fs.writeFileSync('src/components/JackpotArena.tsx', content.replace(target, replacement));
  console.log("Successfully replaced");
} else {
  console.log("Target not found");
}
