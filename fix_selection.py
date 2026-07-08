import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target = '''                    className={`h-9 rounded-md font-black text-[10px] transition-all border flex items-center justify-center shadow-sm ${
                      isSelectedByMe
                        ? 'bg-red-500 border-red-400 text-white shadow-red-500/30 scale-105 z-10 active:scale-90 cursor-pointer'
                        : isTaken
                        ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed overflow-hidden relative'
                        : 'bg-[#1a1c2e] border-gray-800/50 text-gray-400 hover:border-gray-600 hover:bg-[#252841] active:scale-90 cursor-pointer'
                    }`}
                  >
                    {isTaken && !isSelectedByMe && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <div className="w-full h-px bg-gray-500 rotate-45 absolute" />
                        <div className="w-full h-px bg-gray-500 -rotate-45 absolute" />
                      </div>
                    )}
                    <span className={isTaken && !isSelectedByMe ? 'opacity-50' : 'opacity-100'}>{id}</span>'''

replacement = '''                    className={`h-9 rounded-md font-black text-[10px] transition-all border flex items-center justify-center shadow-sm ${
                      isSelectedByMe
                        ? 'bg-red-500 border-red-400 text-white shadow-red-500/30 scale-105 z-10 active:scale-90 cursor-pointer'
                        : isTaken
                        ? 'bg-red-600 border-red-500 text-white cursor-not-allowed opacity-90'
                        : 'bg-[#1a1c2e] border-gray-800/50 text-gray-400 hover:border-gray-600 hover:bg-[#252841] active:scale-90 cursor-pointer'
                    }`}
                  >
                    {isTaken && !isSelectedByMe && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <div className="w-full h-px bg-white rotate-45 absolute" />
                        <div className="w-full h-px bg-white -rotate-45 absolute" />
                      </div>
                    )}
                    <span>{id}</span>'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/components/BingoGame.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
