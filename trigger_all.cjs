const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'announcements.json');
if (fs.existsSync(p)) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  data.forEach(d => {
    d.lastRunTime = 0; // reset
  });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  console.log("Trigger reset!");
} else {
  console.log("Not found.");
}
