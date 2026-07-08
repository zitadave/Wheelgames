import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''                <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-1 rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10 shrink-0">
                   <Clock className="w-3 h-3 text-orange-500 animate-pulse shrink-0" />
                   <span className={`font-mono text-[11px] font-black tracking-tighter ${(bingoRoomState?.timeLeft || 0) < 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
                    {(bingoRoomState?.timeLeft || 0)}s
                  </span>
                </div>'''

replacement = '''                <div className="flex items-center gap-1.5 bg-orange-500/10 px-2 py-1.5 rounded-full border border-orange-500/30 shadow-lg shadow-orange-500/10 shrink-0">
                   <Clock className="w-3.5 h-3.5 text-orange-500 animate-pulse shrink-0" />
                   <span className={`font-mono text-[14px] font-black tracking-tighter ${(bingoRoomState?.timeLeft || 0) < 10 ? 'text-red-500 animate-pulse' : 'text-orange-500'}`}>
                    {(bingoRoomState?.timeLeft || 0)}s
                  </span>
                </div>'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
