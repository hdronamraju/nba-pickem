// Win-total lines from Hoops Junkie. `team` matches ESPN's displayName.
export const LINES_SOURCE = 'Hoops Junkie';
export const WINS_SOURCE_URL = 'https://www.espn.com/nba/standings/_/seasontype/2';

const RAW = [
  ['Oklahoma City Thunder', 61.5], ['San Antonio Spurs', 60.5], ['New York Knicks', 51.5],
  ['Boston Celtics', 50.5], ['Philadelphia 76ers', 50.5], ['Detroit Pistons', 49.5],
  ['Denver Nuggets', 49.5], ['Cleveland Cavaliers', 48.5], ['Minnesota Timberwolves', 47.5],
  ['Houston Rockets', 47.5], ['Toronto Raptors', 46.5], ['Miami Heat', 45.5],
  ['Los Angeles Lakers', 45.5], ['Indiana Pacers', 43.5], ['Atlanta Hawks', 43.5],
  ['Orlando Magic', 43.5], ['Portland Trail Blazers', 41.5], ['Phoenix Suns', 39.5],
  ['Golden State Warriors', 39.5], ['Charlotte Hornets', 38.5], ['Utah Jazz', 37.5],
  ['Washington Wizards', 34.5], ['Dallas Mavericks', 34.5], ['Chicago Bulls', 29.5],
  ['Memphis Grizzlies', 29.5], ['LA Clippers', 28.5], ['New Orleans Pelicans', 28.5],
  ['Milwaukee Bucks', 25.5], ['Brooklyn Nets', 24.5], ['Sacramento Kings', 20.5],
];

export const TEAMS = RAW
  .map(([team, line]) => ({ team, line }))
  .sort((a, b) => b.line - a.line || a.team.localeCompare(b.team));
