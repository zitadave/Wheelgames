import fs from 'fs';

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
                      : item.isSelf
                      ? 'bg-blue-500 dark:bg-blue-600 border-blue-400 dark:border-blue-500 text-white shadow-sm z-30'
                      : 'bg-gray-50 dark:bg-[#161b28] border-gray-200 dark:border-[#232a3b]'
                  }\`}
                >
                  <span className={\`text-[11px] font-black font-mono leading-none z-10 \${item.isSelf ? 'text-white' : 'text-gray-800 dark:text-white'}\`}>{num}</span>
                  <div className={\`flex items-center justify-center mt-0.5 z-10\`}>
                    {item.isSelf ? (
                      <div className="flex items-center gap-0.5 bg-white/20 px-0.5 py-0.5 rounded">
                        <div className="w-2 h-2 rounded-full bg-[#87e1e1] flex items-center justify-center shrink-0">
                          <span className="text-[5px] font-black text-blue-900 leading-none">{item.username ? item.username.charAt(0).toUpperCase() : 'D'}</span>
                        </div>
                        <span className="text-[6px] font-black text-white leading-none tracking-tighter">You</span>
                      </div>
                    ) : (
                      <Lock className="w-2 h-2 shrink-0 text-gray-500 dark:text-gray-500" />
                    )}
                  </div>
                </motion.div>
              );
            }`;

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
                      ? 'bg-[#4a85f6] dark:bg-[#4a85f6] border-[#5b8bf7] dark:border-[#5b8bf7] text-white shadow-sm z-30'
                      : 'bg-gray-50 dark:bg-[#161b28] border-gray-200 dark:border-[#232a3b]'
                  }\`}
                >
                  <span className={\`text-[11px] font-black font-mono leading-none z-10 \${item.isSelf ? 'text-white' : 'text-gray-800 dark:text-white'}\`}>{num}</span>
                  <div className={\`flex items-center justify-center mt-0.5 z-10\`}>
                    {item.isSelf ? (
                      <div className="flex items-center gap-0.5 bg-white/20 px-0.5 py-0.5 rounded">
                        <div className="w-2 h-2 rounded-full bg-[#87e1e1] flex items-center justify-center shrink-0">
                          <span className="text-[5px] font-black text-blue-900 leading-none">{item.username ? item.username.charAt(0).toUpperCase() : 'D'}</span>
                        </div>
                        <span className="text-[6px] font-black text-white leading-none tracking-tighter">You</span>
                      </div>
                    ) : (
                      <Lock className="w-2 h-2 shrink-0 text-gray-500 dark:text-gray-500" />
                    )}
                  </div>
                </motion.div>
              );
            }`;

if (content.includes(target)) {
  fs.writeFileSync('src/components/JackpotArena.tsx', content.replace(target, replacement));
  console.log("Successfully replaced");
} else {
  console.log("Target not found");
}
