import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''              // BINGO LOBBY HEADER: Equal space between back, balance, timer, label, and profile
              <div className="flex items-center justify-between w-full">
                <button 
                  onClick={() => {
                    socket?.emit('bingo_leave', { roomId: selectedBingoRoomId, userId });
                    setSelectedBingoRoomId(null);
                    setBingoRoomState(null);
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-purple-500 active:scale-95 transition-transform border border-gray-200 dark:border-gray-700 shrink-0"
                >
                  <ChevronLeft className="w-4.5 h-4.5" />
                </button>

                <button
                  onClick={() => setIsWalletOpen(true)}
                  className="flex items-center gap-1 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-2 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                >
                  <Coins className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                  <span className="font-mono font-black">{balance === null ? '...' : balance.toLocaleString()}</span>
                </button>

                <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-1 rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10 shrink-0">
                   <Clock className="w-3 h-3 text-orange-500 animate-pulse shrink-0" />
                   <span className={`font-mono text-[13px] font-black tracking-tighter ${displayBingoTime < 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
                    {displayBingoTime}s
                  </span>
                </div>

                <div className="text-[13px] font-black text-orange-400 uppercase tracking-widest px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded-lg whitespace-nowrap shrink-0">
                  {selectedBingoRoomId === 'bingo-10' ? 'ባለ 10' : 'ባለ 20'}
                </div>

                <button
                  onClick={() => setActiveTab('profile')}
                  className="p-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer relative w-8 h-8 flex items-center justify-center overflow-hidden shrink-0"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </button>
              </div>'''

replacement = '''              // BINGO LOBBY HEADER: Equal space between back, balance, timer, label, and profile
              <div className="flex items-center justify-between w-full">
                <button 
                  onClick={() => {
                    socket?.emit('bingo_leave', { roomId: selectedBingoRoomId, userId });
                    setSelectedBingoRoomId(null);
                    setBingoRoomState(null);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-purple-500 active:scale-95 transition-transform border border-gray-200 dark:border-gray-700 shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsWalletOpen(true)}
                  className="flex items-center gap-1 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-1.5 py-1 rounded-full text-[11px] font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                >
                  <Coins className="w-3 h-3 text-yellow-500 shrink-0" />
                  <span className="font-mono font-black">{balance === null ? '...' : balance.toLocaleString()}</span>
                </button>

                <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-1 rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10 shrink-0">
                   <Clock className="w-3 h-3 text-orange-500 animate-pulse shrink-0" />
                   <span className={`font-mono text-[11px] font-black tracking-tighter ${displayBingoTime < 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
                    {displayBingoTime}s
                  </span>
                </div>

                <div className="text-[11px] font-black text-orange-400 uppercase tracking-widest px-1.5 py-1 bg-orange-500/10 border border-orange-500/30 rounded-lg whitespace-nowrap shrink-0">
                  {selectedBingoRoomId === 'bingo-10' ? 'ባለ 10' : 'ባለ 20'}
                </div>

                <button
                  onClick={() => setActiveTab('profile')}
                  className="p-0 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer relative w-7 h-7 flex items-center justify-center overflow-hidden shrink-0"
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
