# Requirements

## Introduction and Purpose

This project is a webapp simulating a blackjack game.  

## Users and Pain Points

- Users consist of people wanting to play blackjack and learn/practice basic strategy as well as  card counting.
- The application will have the ability to display a "best choice" action based on the users hand value and the dealer's hand value per basic strategy
- The basic strategy schema will be pulled from the website at <https://www.blackjackapprenticeship.com/blackjack-strategy-charts/>, particularly the chart of best actions.
- The application will keep track of the card count following standard card counting techniques and it will refresh to zero when the shoe gets shuffled.

## Functional Requirements

- As a user, when I start the game, I shall enter my name into an input.
- As a user, when I start the game, I shall see a display of my chip count.
- As a user, when I start a hand, I shall be able to enter a value for my bet and press a button to implement that bet.
- As a user, when I am playing the game, I shall see my name and all other player's names displayed on the UI at all times.
- As a user, when I am playing the game, I shall see representations of the other players spread out equally around an image of a blackjack table.
- As a user, when I am playing the game, I shall see a representation of the dealer on the opposite side of the table from the players.
- As a user, when I am playing the game, I shall see a set of buttons to press representing the possible actions that I can perform next.
- As a user, when I am dealt a blackjack, I shall be paid by the dealer at a ratio of 3:2 according to my bet(s).
- As a user, when my final card value (stay/stand) is greater than the dealer's final card value, I shall be paid by the dealer at even money (a ratio of 1:1).
- As a user, when starting the game, I shall log in to an account that keeps track of session details
- As a user, when I am starting the game and my chip count is below $500, I shall have the option to increase my chip count to $500.


## Non-Functional Requirements

- When a player goes bust, it means the cards they have been dealt add up to more than 21.
- If the dealer is dealt a blackjack, all players that were not also dealt a blackjack lose thier bet.  Players that were also dealt a blackjack keep thier bet (a push).
- When the hand is over, if a player has the same value hand as the dealer, the player keeps thier bet (a push).
- Players shall be able to chose to split cards when they are dealt a pair or any two 10 valued cards.
- Players shall be able to double down per standard blackjack rules.
- If the dealer is dealt an Ace face up, the players shall have the option to place an insurance bet.  Insurance bets can consist of up to half the players current bet.  Insurance pays at a rate of 2:1 from the dealer's chip count if the dealer does in fact have a blackjack.  If the dealer does not have a blackjack, the player loses thier insurance bet.  

## Acceptance Criteria

- When a hand is complete, then user's chip counts are adjust correctly based on thier bets.
- When the dealer is dealt a blackjack and the user is not, then the user loses the hand.
- When a user is dealt a blackjack and the user is not, then the user gets paid at a rate of 3:2.
- When the user is placed at a table, then the name of all other players at the table are displayed.
- When a user logs in, then they are met with a UI to join a table.
- When a user logs in, then they can click a button to view thier statistics.

## Glossary/Definitions

- A deck shall consist of 52 standard playing cards.
- A blackjack is a hand where the first 2 cards dealt to a player or the dealer add up to 21 (e.g. an ace and a face card or a 10.)
