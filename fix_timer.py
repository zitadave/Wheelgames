import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

target1 = '''  const [displayBingoTime, setDisplayBingoTime] = useState<number>(0);

  useEffect(() => {
    let timer: any;
    if (bingoRoomState?.status === 'lobby' || bingoRoomState?.status === 'result') {
      setDisplayBingoTime(bingoRoomState.timeLeft);
      timer = setInterval(() => {
        setDisplayBingoTime(prev => Math.max(0, prev - 1));
      }, 1000);
    } else {
      setDisplayBingoTime(0);
    }
    return () => clearInterval(timer);
  }, [bingoRoomState]);'''

replacement1 = '''  const displayBingoTime = (bingoRoomState?.status === 'lobby' || bingoRoomState?.status === 'result') ? bingoRoomState.timeLeft : 0;'''

code = code.replace(target1, replacement1)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')
