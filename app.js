import express from 'express';
import ngrok from 'ngrok'
import Promise from 'bluebird';
import fetch from 'node-fetch';
import moment from 'moment';

const app = express();

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_KEY= "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjEyNjg1NDI2MiwidWlkIjoyNTAwNTQ4MCwiaWFkIjoiMjAyMS0xMC0wMVQwNDozMTo1MS4yODdaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTAwNTIyNjgsInJnbiI6InVzZTEifQ.SPTmbjdnXNWtUuNy6jQ2C-7FAe85Yz8pvJhKs8fL4y4";

app.use(express.json());

app.get('/', function (req,res) {
  console.log('webhook call');
  res.send('OK');
})

app.post('/', function (req, res) {

  if (!req.body.event) {
    return res.send(req.body);
  }

  let event = req.body.event;
  if (event.type === 'update_column_value' && event.columnId === 'status') {
    let itemId = req.body.event.pulseId;
    let appendText = [];
    appendText.push(' ' + req.body.event.columnTitle +  ' - ' + req.body.event.value.label.text);
    Promise.bind({})
      // Get item details
      .then(() => getItem(itemId))
      // Append item title and values in array
      .then(itemDetails => {
        console.log(JSON.stringify(itemDetails));
        // Get item which match with event item id
        let items = itemDetails.data.items[0];
        return appendColumns(items, appendText);
      })
      // Upload file
      .then((appendText) => uploadFile(appendText, itemId));
  } else {
    return res.send(req.body);
  }
});

// listen to port 3000
app.listen(3000, function () {
  console.log('Listening for webhooks on port 3000');
  // start ngrok and create a tunnel to port 3000
  (async function() { await ngrok.connect(3000);})();
})

/***
 * Return item details
 * @param itemId
 * @returns {Promise<Response>}
 */
function getItem(itemId) {
  let query = "query { items (ids: [" + itemId + " ]) { id name state created_at updated_at column_values { id title value }}}";
  return fetch (MONDAY_API_URL, setRequest('post', query)).then(result => result.json()).catch(err => console.log(err));;
}

/***
 * Upload file for specific item
 * @param itemId
 * @param appendText
 */
function uploadFile(appendText, itemId) {
  //
  const url = MONDAY_API_URL + '/file';
  //
  const query = 'mutation add_file($file: File!, $itemId: Int!, $columnId: String!) {add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) {id}}'
  //
  let data = "";
  const boundary = "xxxxxxxxxxxxxxx";

  const vars = { "itemId": itemId, "columnId": "files" };

  const map = { "image": "variables.file" };

  const upfile = './' + itemId + '.txt' ;

  console.log('------------File read operation start------------');


  appendText = appendText.join(" \n ");
  let buf = Buffer.from(appendText.toString(), 'utf8');

  console.log('------------File read operation end------------');
  data += "--" + boundary + "\r\n";
  data += "Content-Disposition: form-data; name=\"query\"; \r\n";
  data += "Content-Type:application/json\r\n\r\n";
  data += "\r\n" + query + "\r\n";

  // construct variables part
  data += "--" + boundary + "\r\n";
  data += "Content-Disposition: form-data; name=\"variables\"; \r\n";
  data += "Content-Type:application/json \r\n\r\n";
  data += "\r\n" + JSON.stringify(vars) + "\r\n";

  // construct map part
  data += "--" + boundary + "\r\n";
  data += "Content-Disposition: form-data; name=\"map\"; \r\n";
  data += "Content-Type:application/json\r\n\r\n";
  data += "\r\n" + JSON.stringify(map)+ "\r\n";

  // construct file part - the name needs to be the same as passed in the map part of the request. So if your map is {"image":"variables.file"}, the name should be image.
  data += "--" + boundary + "\r\n";
  data += "Content-Disposition: form-data; name=\"image\"; filename=\"" + upfile + "\"\r\n";
  data += "Content-Type:application/octet-stream\r\n\r\n";

  const payload = Buffer.concat([
    Buffer.from(data, "utf8"),
    new Buffer.from(buf, 'binary'),
    Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"),
  ]);

  const options = {
    method: "post",
    headers: {
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      "Authorization": API_KEY,
    },
    body: payload,
  };

  // make request
  console.log('------------Uploading file------------');
  fetch(url, options)
    .then(res => res.json())
    .then(res => console.log('------------file Uploaded------------'))
    .catch(err => console.log(err));
}

/***
 * Get person details
 * @param personId
 */
function getPersonDetails(personId) {
  let query = "query { users (ids: [" + personId + "]) { account { name id}}}";
  return fetch(MONDAY_API_URL, setRequest('post', query))
    .then(personDetails => personDetails.json())
    .then(personDetails => personDetails.data.users[0].account.name)
    .catch(err => console.log(err));
}

/***
 * set request
 * @param method
 * @param query
 * @returns {{headers: {Authorization: string, "Content-Type": string}, method: string, body: string}}
 */
function setRequest(method, query) {
  return {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY
    },
    body: JSON.stringify({ query: query })
  }
}

/***
 * Append columns content in array
 * @param items
 * @param appendText
 * @returns {Promise<*>}
 */
async function appendColumns(items, appendText) {
  for (const key in items) {
    if (key !== 'column_values') {
      appendText.push(key + ' - ' + items[key]);
    }
  }

  let columns = items.column_values;

  for (const col of columns) {
    col.value = JSON.parse(col.value)
    switch (col.id) {
      case 'person':
        if(col.value && col.value.personsAndTeams) {
          let person = await getPersonDetails(col.value.personsAndTeams[0].id)
          appendText.push(col.title + ' - ' + person)
        } else {
          appendText.push(col.title + ' - ' + col.value);
        }
        break;
      case 'date4':

        let fullDate = null;
        if(col.value && col.value.date) {
          fullDate = moment(col.value.date).format('MMM DD');
          if (col.value.time) {
            let time = moment(col.value.time, "HH:mm:ss").format('HH:MM A');
            fullDate = fullDate + ' ' + time;
          }
        }
        appendText.push(col.title + ' - ' + fullDate);
        break;
      case 'text':
      case 'numbers':
      case 'formula':
        appendText.push(col.title + ' - ' + col.value)
        break;
      case 'dropdown':
        if (col.value && col.value.ids) {
          appendText.push(col.title + ' - ' + col.value.ids)
        } else {
          appendText.push(col.title + ' - ' + col.value);
        }
        break;
      case 'subitems':
        if (col.value && col.value.linkedPulseIds) {
          let itemsToGet = col.value.linkedPulseIds.map(linkedPulseId => parseInt(linkedPulseId.linkedPulseId))
          let getItems = await getItem(itemsToGet);
          appendText.push('----------Sub Items-----------')
          getItems.data.items.forEach(item => appendColumns(item, appendText));
          appendText.push('------------------------------');
        } else {
          appendText.push(col.title + ' - ' + col.value);
        }
        break;
      case 'checkbox':
        col.value && col.value.checked ? appendText.push(col.title + ' - ' + col.value.checked) : appendText.push(col.title + ' - ' + col.value);
        break;
      case 'tags':
        if (col.value && col.value.tag_ids) {
          appendText.push(col.title + ' - ' + col.value.tag_ids);
        } else {
          appendText.push(col.title + ' - ' + col.value);
        }
        break;
    }
  }
  return appendText;
}
