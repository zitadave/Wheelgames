with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''    // Fill remaining online count using high-fidelity spectator records so list length matches totalActivePlayersCount
    const remainingCount = totalActivePlayersCount - list.length;
    if (remainingCount > 0) {
      const mockSpectators = [
        { name: "Almaz_K", photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80" },
        { name: "Dawit_Y", photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80" },
        { name: "Makeda_Gold", photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80" },
        { name: "Selam_Ethio", photo: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150&q=80" },
        { name: "Yonas_T", photo: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80" },
        { name: "Eskinder_M", photo: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=150&q=80" },
        { name: "Saron_Hailu", photo: "https://images.unsplash.com/photo-1531123897727-8f129e1bf98c?auto=format&fit=crop&w=150&q=80" },
        { name: "Nahom_B", photo: "https://images.unsplash.com/photo-1504257432389-523431e1564e?auto=format&fit=crop&w=150&q=80" },
        { name: "Bereket_A", photo: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=150&q=80" },
        { name: "Tewodros_F", photo: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=150&q=80" }
      ];
      for (let i = 0; i < remainingCount; i++) {
        const mockId = `mock_user_${i}_${roomState?.roundId || 0}`;
        const itemIdx = (i + (roomState?.roundId || 0)) % mockSpectators.length;
        const specObj = mockSpectators[itemIdx];
        list.push({
          id: mockId,
          username: specObj.name,
          photoUrl: specObj.photo,
          amount: 0,
          isWinner: false,
          side: undefined
        });
      }
    }'''

if target in code:
    code = code.replace(target, '')
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
