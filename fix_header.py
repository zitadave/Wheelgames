import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

# First, I'll identify the header block
start_tag = '<header'
end_tag = '</header>'

start_idx = code.find(start_tag)
end_idx = code.find(end_tag) + len(end_tag)

original_header = code[start_idx:end_idx]

new_header = '''<header className="flex justify-between items-center px-4 py-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shrink-0 transition-colors duration-300 z-40 fixed top-0 left-0 right-0 w-full max-w-md mx-auto">
            {activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status === 'lobby' ? (
              // BINGO LOBBY HEADER: Equal space between back, balance, timer, label, and profile
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
              </div>
            ) : (
              // DEFAULT HEADER FOR OTHER TABS
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsWalletOpen(true)}
                    className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                  >
                    <Coins className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="font-mono font-black">{balance === null ? '...' : balance.toLocaleString()}</span>
                  </button>

                  {activeTab === 'bingo' && bingoRoomState && (bingoRoomState.status === 'playing' || bingoRoomState.status === 'result') && (
                    <div className="flex flex-col items-center justify-center bg-green-500/10 dark:bg-green-500/5 text-green-600 dark:text-green-400 border border-green-500/30 rounded-lg py-1 px-2 select-none shrink-0 text-[9px] font-bold leading-none gap-1 animate-in fade-in duration-300 w-[85px]">
                      <span className="text-[9px] font-black tracking-wider text-green-600/70 dark:text-green-400/70 uppercase font-bold">DERASH</span>
                      <div className="border-t border-green-500/20 pt-1 w-full text-center">
                        <span className="font-mono font-black text-[10px] text-green-600 dark:text-green-400">
                          {getDerashAmount().toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center">
                  {activeTab === 'even_odd' && roomState?.status !== 'spinning' && roomState?.status !== 'result' && (
                    <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-900/50 animate-in fade-in duration-300">
                      <Clock className="w-3 h-3 text-blue-500 animate-pulse" />
                      <span className={`font-mono text-sm font-black tracking-tight ${displayTime < 10 ? 'text-red-500 animate-pulse' : 'text-blue-600 dark:text-blue-400'}`}>
                        00:{displayTime.toString().padStart(2, '0')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {activeTab === 'bingo' ? (
                    bingoRoomState && (bingoRoomState.status === 'playing' || bingoRoomState.status === 'result') && (
                      <div className="flex flex-col items-center justify-center bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg py-1 px-2 select-none shrink-0 text-[9px] font-bold leading-none gap-1 animate-in fade-in duration-300 w-[85px]">
                        <button 
                          id="players-portal-btn-top"
                          onClick={() => setIsPlayersDrawerOpen(true)}
                          className="flex items-center justify-center gap-1 font-black text-orange-500 active:scale-95 transition-transform w-full"
                        >
                          <span>PLAYERS</span>
                          <span className="font-mono font-black text-gray-800 dark:text-gray-100">{totalActivePlayersCount}</span>
                        </button>
                        <div className="flex items-center justify-center gap-1 font-black text-purple-500 border-t border-gray-300/30 dark:border-gray-700/30 pt-1 w-full">
                          <span>CALLED</span>
                          <span className="font-mono font-black text-gray-800 dark:text-gray-100">{bingoRoomState.calledBalls?.length || 0}</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <button 
                      id="players-portal-btn-top"
                      onClick={() => setIsPlayersDrawerOpen(true)}
                      className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer animate-in fade-in duration-300"
                    >
                      <Users className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                      <span className="font-mono tracking-tight font-bold">{totalActivePlayersCount}</span>
                    </button>
                  )}
                  
                  {activeTab === 'bingo' && bingoRoomState && (bingoRoomState.status === 'playing' || bingoRoomState.status === 'result') && (
                    <button
                      onClick={() => setBingoSoundEnabled(!bingoSoundEnabled)}
                      className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-green-500 hover:text-green-600 dark:text-green-400 dark:hover:text-green-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer flex items-center justify-center w-8 h-8 shrink-0 select-none animate-in fade-in duration-300"
                      title={bingoSoundEnabled ? "Mute Caller Voice" : "Unmute Caller Voice"}
                    >
                      {bingoSoundEnabled ? <Volume2 className="w-4.5 h-4.5" /> : <VolumeX className="w-4.5 h-4.5 text-gray-400" />}
                    </button>
                  )}
                  
                  {!(activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status !== 'lobby') && (
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
                  )}
                </div>
              </>
            )}
          </header>'''

code = code[:start_idx] + new_header + code[end_idx:]

with open('src/App.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')
