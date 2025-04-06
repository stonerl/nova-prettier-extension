import React from 'react'

const Button = ({ label, onClick, disabled = false }) => {
  return (
    <button onClick={onClick} disabled={disabled}>
      {' '}
      {label}{' '}
    </button>
  )
}

function App() {
  const handleClick = () => {
    console.log('Clicked!')
  }

  return (
    <div className="App">
      <h1> Hello, world! </h1>
      <Button label="Click me" onClick={handleClick} />
      <input type="text" placeholder="Enter something" />
      <CustomComponent
        propOne="value1"
        propTwo={123}
        propThree={() => {
          return true
        }}
      />
      {[1, 2, 3].map((n, index) => (
        <span key={index}> {n} </span>
      ))}
    </div>
  )
}

const CustomComponent = (props) => {
  return (
    <section>
      <p>{props.propOne}</p>
      <p>{props.propTwo}</p>
      <p>{props.propThree && props.propThree()}</p>
    </section>
  )
}

export default App
