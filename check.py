import re
data = open('questions.js', encoding='utf-8').read()
qs = re.findall(r'"question":\s*"([^"]+)"', data)
for i, q in enumerate(qs[:10]):
    print(f"Q{i+1}: {q[:100]}")
    print()